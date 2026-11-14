const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const PORT = Number(process.env.MBS_CLOUD_PORT || 8787);
const API_KEY = String(process.env.MBS_CLOUD_API_KEY || 'change-this-key');
const DATA_DIR = process.env.MBS_CLOUD_DATA_DIR || path.join(process.cwd(), 'server-data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'cloud-gateway.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS workspaces (workspace_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, database_file TEXT);
CREATE TABLE IF NOT EXISTS users (workspace_id TEXT NOT NULL, username TEXT NOT NULL, full_name TEXT NOT NULL, user_type TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id, username));
CREATE TABLE IF NOT EXISTS messages (remote_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, sender_username TEXT, sender_name TEXT NOT NULL, recipient_username TEXT NOT NULL, recipient_name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, category TEXT NOT NULL, parent_remote_id TEXT, is_read INTEGER NOT NULL DEFAULT 0, deleted_by_sender INTEGER NOT NULL DEFAULT 0, deleted_by_recipient INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_cloud_messages_recipient ON messages(workspace_id, recipient_username, created_at);
CREATE INDEX IF NOT EXISTS idx_cloud_messages_sender ON messages(workspace_id, sender_username, created_at);
`);

function json(res, status, value) { const body = JSON.stringify(value); res.writeHead(status, {'content-type':'application/json; charset=utf-8'}); res.end(body); }
function auth(req) { return req.headers['x-api-key'] === API_KEY && typeof req.headers['x-workspace-id'] === 'string' && req.headers['x-workspace-id'].trim(); }
function workspace(req) { return String(req.headers['x-workspace-id']).trim(); }
function body(req) { return new Promise((resolve,reject)=>{ const chunks=[]; req.on('data',c=>chunks.push(c)); req.on('end',()=>resolve(Buffer.concat(chunks))); req.on('error',reject); }); }
function now(){ return new Date().toISOString(); }
function text(res, status, value){ res.writeHead(status, {'content-type':'text/plain; charset=utf-8'}); res.end(value); }

const server = http.createServer(async (req,res)=>{
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res,200,{ok:true,service:'MBS Cloud Gateway',time:now()});
    if (!auth(req)) return text(res,401,'Unauthorized cloud request.');
    const ws = workspace(req);
    const callerUsername = String(req.headers['x-user'] || '').trim();
    if (callerUsername) {
      const caller = db.prepare('SELECT status FROM users WHERE workspace_id=? AND username=?').get(ws, callerUsername);
      if (caller && caller.status !== 'active') return text(res,403,'Inactive cloud user.');
    }

    if (req.method === 'GET' && req.url === '/v1/users') {
      return json(res,200,db.prepare('SELECT username,full_name,user_type,status FROM users WHERE workspace_id=? ORDER BY full_name').all(ws));
    }
    if (req.method === 'POST' && req.url === '/v1/users') {
      const data=JSON.parse((await body(req)).toString('utf8')); if(!data.username) return text(res,400,'username is required');
      db.prepare(`INSERT INTO users(workspace_id,username,full_name,user_type,status,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id,username) DO UPDATE SET full_name=excluded.full_name,user_type=excluded.user_type,status=excluded.status,updated_at=excluded.updated_at`).run(ws,String(data.username),String(data.full_name||data.username),String(data.user_type||'employee'),String(data.status||'active'),now());
      return json(res,200,{success:true});
    }

    if (req.method === 'GET' && req.url === '/v1/database/status') {
      const row=db.prepare('SELECT revision,database_file FROM workspaces WHERE workspace_id=?').get(ws);
      return json(res,200,{exists:Boolean(row?.database_file && fs.existsSync(row.database_file)),revision:Number(row?.revision||0)});
    }
    if (req.method === 'POST' && req.url === '/v1/database/upload') {
      const data=await body(req); if(!data.length) return text(res,400,'Empty database upload.');
      const row=db.prepare('SELECT revision FROM workspaces WHERE workspace_id=?').get(ws);
      const current=Number(row?.revision||0);
      const expected=Number(req.headers['x-if-revision']||0);
      if(current!==expected) return text(res,409,'Cloud database revision conflict. Refresh/download the latest shared database first.');
      const revision=current+1;
      const file=path.join(DATA_DIR,`${crypto.createHash('sha256').update(ws).digest('hex')}.sqlite`);
      const temp=`${file}.tmp`; fs.writeFileSync(temp,data); fs.renameSync(temp,file);
      db.prepare('INSERT INTO workspaces(workspace_id,revision,database_file) VALUES(?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET revision=excluded.revision,database_file=excluded.database_file').run(ws,revision,file);
      return json(res,200,{success:true,revision});
    }
    if (req.method === 'GET' && req.url === '/v1/database/download') {
      const row=db.prepare('SELECT revision,database_file FROM workspaces WHERE workspace_id=?').get(ws); if(!row?.database_file || !fs.existsSync(row.database_file)) return text(res,404,'No cloud database exists for this workspace.');
      const stat=fs.statSync(row.database_file); res.writeHead(200,{'content-type':'application/octet-stream','content-length':stat.size,'x-cloud-revision':String(row.revision)}); return fs.createReadStream(row.database_file).pipe(res);
    }

    const messageMatch = req.url.match(/^\/v1\/messages(?:\/([^/?]+))?(?:\?(.*))?$/);
    if (messageMatch) {
      const remoteId=messageMatch[1];
      if(req.method==='GET') { const params=new URLSearchParams(messageMatch[2]||''); const user=params.get('user'); const caller=req.headers['x-user']; if(!user || caller!==user) return text(res,403,'Message identity mismatch.'); return json(res,200,db.prepare(`SELECT * FROM messages WHERE workspace_id=? AND (sender_username=? OR recipient_username=?) AND (sender_username=? OR deleted_by_recipient=0) ORDER BY created_at DESC`).all(ws,user,user,user)); }
      if(req.method==='POST') { const d=JSON.parse((await body(req)).toString('utf8')); const caller=req.headers['x-user']; if(!caller || caller!==d.sender_username) return text(res,403,'Sender identity mismatch.'); const id=crypto.randomUUID(); const stamp=now(); db.prepare(`INSERT INTO messages(remote_id,workspace_id,sender_username,sender_name,recipient_username,recipient_name,subject,body,category,parent_remote_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,ws,d.sender_username||null,d.sender_name||'',d.recipient_username,d.recipient_name||d.recipient_username,d.subject,d.body,d.category||'general',d.parent_remote_id||null,stamp,stamp); return json(res,200,{success:true,remote_id:id,created_at:stamp}); }
      if(req.method==='PATCH' && remoteId) { const d=JSON.parse((await body(req)).toString('utf8')); const caller=req.headers['x-user']; const existing=db.prepare('SELECT sender_username,recipient_username FROM messages WHERE remote_id=? AND workspace_id=?').get(remoteId,ws); if(!existing || (caller!==existing.sender_username && caller!==existing.recipient_username)) return text(res,403,'Message access denied.'); const sets=[]; const vals=[]; for(const k of ['subject','body','is_read','deleted_by_sender','deleted_by_recipient']) if(d[k]!==undefined){ if((k==='subject'||k==='body') && caller!==existing.sender_username) return text(res,403,'Only the sender can edit a message.'); if(k==='is_read' && caller!==existing.recipient_username) return text(res,403,'Only the recipient can mark a message read.'); sets.push(`${k}=?`);vals.push(d[k]); } sets.push('updated_at=?');vals.push(now(),remoteId,ws); db.prepare(`UPDATE messages SET ${sets.join(',')} WHERE remote_id=? AND workspace_id=?`).run(...vals); return json(res,200,{success:true}); }
      if(req.method==='DELETE' && remoteId) { db.prepare('UPDATE messages SET deleted_by_sender=CASE WHEN sender_username=? THEN 1 ELSE deleted_by_sender END, deleted_by_recipient=CASE WHEN recipient_username=? THEN 1 ELSE deleted_by_recipient END WHERE remote_id=? AND workspace_id=?').run(req.headers['x-user']||'',req.headers['x-user']||'',remoteId,ws); return json(res,200,{success:true}); }
    }

    const dbMatch = req.url.match(/^\/v1\/data\/([A-Za-z_][A-Za-z0-9_]*)?(?:\/([^/?]+))?(?:\?(.*))?$/);
    if (dbMatch) {
      if (!callerUsername) return text(res,401,'Cloud user identity is required.');
      const table = tableName(dbMatch[1]);
      const recordId = dbMatch[2] ? decodeURIComponent(dbMatch[2]) : null;
      const params = new URLSearchParams(dbMatch[3] || '');
      const remoteDb = dbForWorkspace(ws);
      try {
        const pk = primaryKey(remoteDb, table);
        if (req.method === 'GET') {
          if (recordId !== null) {
            if (!pk) return text(res,400,'Table has no primary key.');
            const row = remoteDb.prepare(`SELECT * FROM ${table} WHERE ${pk}=?`).get(recordId);
            return row ? json(res,200,row) : text(res,404,'Record not found.');
          }
          const limit = Math.min(Math.max(Number(params.get('limit') || 500),1),2000);
          const rows = remoteDb.prepare(`SELECT * FROM ${table} LIMIT ?`).all(limit);
          return json(res,200,{rows, count:rows.length});
        }
        if (req.method === 'POST') {
          const record = await jsonBody(req); validateRecord(record);
          const keys=Object.keys(record); if(!keys.length) return text(res,400,'Empty record.');
          const sql=`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`;
          const result=remoteDb.prepare(sql).run(...keys.map(k=>record[k]));
          return json(res,201,{success:true,id:pk ? (record[pk] ?? result.lastInsertRowid) : result.lastInsertRowid});
        }
        if (req.method === 'PATCH' && recordId !== null) {
          if (!pk) return text(res,400,'Table has no primary key.');
          const record=await jsonBody(req); validateRecord(record);
          const keys=Object.keys(record).filter(k=>k!==pk); if(!keys.length) return text(res,400,'No fields to update.');
          const result=remoteDb.prepare(`UPDATE ${table} SET ${keys.map(k=>`${k}=?`).join(',')} WHERE ${pk}=?`).run(...keys.map(k=>record[k]),recordId);
          return result.changes ? json(res,200,{success:true}) : text(res,404,'Record not found.');
        }
        if (req.method === 'DELETE' && recordId !== null) {
          if (!pk) return text(res,400,'Table has no primary key.');
          const result=remoteDb.prepare(`DELETE FROM ${table} WHERE ${pk}=?`).run(recordId);
          return result.changes ? json(res,200,{success:true}) : text(res,404,'Record not found.');
        }
      } finally { remoteDb.close(); }
    }

    return text(res,404,'Not found');
  } catch(e) { console.error(e); return text(res,500,e?.message||'Server error'); }
});


const SAFE_TABLES = new Set([
  'products','customers','employees','orders','inventory_transactions','transactions',
  'accounts','journal_entries','ledger_entries','invoices','certificates','notifications',
  'employee_contracts','users','sessions','password_reset_requests','audit_log',
  'permission_profiles','permissions','user_permissions','profile_permissions','company_settings'
]);

function tableName(value) {
  const name = String(value || '');
  if (!SAFE_TABLES.has(name)) throw new Error('Unsupported table.');
  return name;
}
function dbForWorkspace(ws) {
  const file = path.join(DATA_DIR, `${crypto.createHash('sha256').update(`db:${ws}`).digest('hex')}.sqlite`);
  const handle = new Database(file);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');
  return handle;
}
function jsonBody(req) { return body(req).then(b => JSON.parse(b.toString('utf8') || '{}')); }
function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Record must be an object.');
  for (const key of Object.keys(record)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid column: ${key}`);
  }
}
function primaryKey(dbh, table) {
  const cols = dbh.prepare(`PRAGMA table_info(${table})`).all();
  return cols.find(c => c.pk === 1)?.name || cols.find(c => c.name === 'id')?.name || null;
}

server.listen(PORT,()=>console.log(`MBS Cloud Gateway listening on http://0.0.0.0:${PORT}`));

