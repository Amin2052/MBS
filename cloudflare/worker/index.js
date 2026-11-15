import { scrypt, timingSafeEqual } from "node:crypto";

const SESSION_TTL = 8 * 60 * 60;
const MAX_BODY = 1024 * 1024;
const ALLOWED_COLLECTIONS = new Set([
  "products", "customers", "employees", "orders", "inventory_transactions",
  "transactions", "accounts", "journal_entries", "ledger_entries", "invoices",
  "certificates", "notifications", "employee_contracts", "users", "audit_log",
  "permission_profiles", "permissions", "user_permissions", "profile_permissions",
  "company_settings"
]);

const COLLECTION_MODULE = {
  products: "products", customers: "customers", employees: "employees", orders: "orders",
  invoices: "invoices", inventory_transactions: "inventory", transactions: "accounting",
  accounts: "accounting", journal_entries: "accounting", ledger_entries: "accounting",
  certificates: "certificates", notifications: "dashboard", employee_contracts: "employees",
  users: "settings", permission_profiles: "settings", permissions: "settings",
  user_permissions: "settings", profile_permissions: "settings", company_settings: "settings",
  audit_log: "reports"
};

const ACTION_TO_PERMISSION = { read: "view", create: "create", edit: "edit", delete: "delete" };
const enc = new TextEncoder();

// Relational schema registry for handleData(). Column lists are copied
// 1:1 from cloudflare/migrations/0001_mbs_core_schema.sql, which mirrors
// src/database/database.ts (the real MBS SQLite schema). `local_id` is the
// reconciliation key: it stores whatever identity value the desktop client
// already sends as the record's `id` (see cloud-sync-manager.ts). D1's own
// `id` is a separate, D1-assigned autoincrement column and is never set
// directly from client input.
const TABLE_SCHEMAS = {
  products: ["name", "category", "sku", "price", "stock", "product_id"],
  customers: ["name", "phone", "email", "address", "customer_id"],
  employees: ["employee_number", "first_name", "last_name", "gender", "date_of_birth", "phone", "email",
    "address", "department", "designation", "joining_date", "employment_status", "salary",
    "emergency_contact_name", "emergency_contact_phone", "nid_passport", "notes",
    "employment_type", "resignation_date", "contract_start_date", "contract_end_date",
    "identity_type", "identity_number"],
  employee_contracts: ["employee_id", "contract_start_date", "contract_end_date", "extension_reason",
    "previous_contract_id", "is_current"],
  orders: ["order_id", "customer_id", "customer_name", "product_id", "product_name", "quantity",
    "price", "total", "status"],
  inventory_transactions: ["product_id", "type", "quantity", "note"],
  transactions: ["transaction_id", "type", "category", "description", "amount", "payment_method",
    "reference_no", "transaction_date", "notes", "source_invoice_id"],
  accounts: ["code", "name", "type", "is_system"],
  journal_entries: ["journal_id", "entry_date", "debit_account_id", "debit_account_name",
    "credit_account_id", "credit_account_name", "amount", "reference", "reference_type", "description"],
  ledger_entries: ["journal_id", "account_id", "account_name", "customer_id", "customer_name",
    "entry_date", "debit", "credit", "running_balance", "reference_id", "reference_type",
    "description", "notes"],
  invoices: ["invoice_id", "order_id", "customer_id", "customer_name", "items", "subtotal", "discount",
    "tax", "total", "paid", "due", "payment_method", "status", "invoice_date", "due_date", "notes"],
  certificates: ["certificate_id", "customer_id", "customer_name", "product_id", "product_name", "title",
    "description", "issue_date", "expiry_date", "status", "certificate_category", "certificate_type",
    "employee_name", "serial_number", "employee_id", "employee_number_snapshot", "employee_name_snapshot",
    "department_snapshot", "designation_snapshot", "employment_type_snapshot", "joining_date_snapshot",
    "employment_status_snapshot", "product_name_snapshot", "category_snapshot", "sku_snapshot", "printed_at"],
  notifications: ["module", "action", "message", "app_user", "before_data", "after_data"],
  permissions: ["permission_key", "module", "action", "description"],
  audit_log: ["user_id", "username", "user_type", "module", "action", "record_id", "record_label",
    "old_value", "new_value"],
  company_settings: null, // singleton row (id fixed to 1), handled separately below
};

function now() { return new Date().toISOString(); }
function b64(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function randomToken() { const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); return b64(bytes); }
async function sha256(value) { return b64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)))); }
function constantTimeText(a, b) {
  const aa = enc.encode(String(a));
  const bb = enc.encode(String(b));
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(Buffer.from(aa), Buffer.from(bb));
}

function json(data, status = 200, request, env) {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  applyCors(headers, request, env);
  return new Response(JSON.stringify(data), { status, headers });
}
function text(message, status = 200, request, env) {
  const headers = new Headers({ "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  applyCors(headers, request, env);
  return new Response(message, { status, headers });
}
function applyCors(headers, request, env) {
  const origin = request.headers.get("Origin");
  const allowed = String(env.MBS_CORS_ORIGIN || "").trim();
  if (allowed && origin === allowed) headers.set("access-control-allow-origin", origin);
  else if (!allowed && origin === new URL(request.url).origin) headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-headers", "content-type,authorization,x-api-key,x-workspace-id,x-if-revision");
  headers.set("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  headers.set("vary", "Origin");
}

// SECURITY MODEL NOTE (multi-tenant, shared Worker + shared D1):
//
// This function is a LOOKUP HINT ONLY -- it says which workspace's `users`
// row to try to match against at login. It must NEVER be treated as proof
// of workspace membership by itself, because nothing about an HTTP header
// is trustworthy on its own. The two places genuine workspace identity
// actually gets established are:
//   1. Login (handleAuth "/v1/auth/login"): this function picks WHICH
//      workspace's username to look up, but the request only succeeds if
//      the password also matches that exact user row -- so a client lying
//      about the workspace here can only ever "succeed" by presenting
//      real credentials for a real user of that real workspace, which is
//      not a breach, it's a legitimate login. Every subsequent request in
//      that session is then bound to `user.workspace_id` as read back from
//      the DB row itself (see authUser()), never to this header again.
//   2. API-key auth (resolveWorkspaceForApiKey below): the workspace is
//      only accepted once client-supplied key bytes are verified against
//      that SPECIFIC workspace's stored key hash. A wrong/guessed
//      workspace_id with someone else's key (or no key) is rejected.
// Every handler in this file must use the WORKSPACE DERIVED FROM #1 or #2
// (i.e. `user.workspace_id` or the return value of
// resolveWorkspaceForApiKey()) to scope its queries -- never this raw
// header value directly, outside of the login lookup itself.
function workspaceForRequest(request, env) {
  const configured = String(env.MBS_WORKSPACE_ID || "").trim();
  const requested = String(request.headers.get("x-workspace-id") || "").trim();
  if (configured) {
    if (requested && requested !== configured) throw new Error("Workspace mismatch.");
    return configured;
  }
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(requested)) throw new Error("Workspace is required.");
  return requested;
}

// Verifies the supplied x-api-key ACTUALLY belongs to the workspace named
// by x-workspace-id, by comparing against that workspace's own stored key
// hash -- not a single Worker-wide secret. Returns the verified
// workspace_id on success, or null. This is the API-key equivalent of
// "the password matched this specific user row": the header names a
// claimed identity, the hash comparison is what proves it, so a client
// that knows workspace B's id but only has workspace A's key gets null,
// not workspace B's data.
async function resolveWorkspaceForApiKey(request, env) {
  const requestedWorkspace = String(request.headers.get("x-workspace-id") || "").trim();
  const suppliedKey = String(request.headers.get("x-api-key") || "");
  if (!requestedWorkspace || !suppliedKey) return null;
  const row = await env.DB.prepare("SELECT workspace_id, api_key_hash, status FROM workspaces WHERE workspace_id=?").bind(requestedWorkspace).first();
  if (!row || row.status !== "active") return null;
  if (row.api_key_hash) {
    return (await verifyPassword(suppliedKey, row.api_key_hash)) ? row.workspace_id : null;
  }
  // Legacy bridge, temporary: the one pre-multi-tenant customer
  // ("mooral-main") was provisioned before per-workspace keys existed, and
  // this Worker has no access to that plaintext secret to hash it
  // retroactively. It is intentionally the ONLY workspace allowed to fall
  // back to the single global env.MBS_API_KEY secret -- every other
  // workspace_id with a NULL api_key_hash is refused outright, so this
  // bridge can never be used to claim a workspace other than the one
  // legacy tenant it exists for. Once mooral-main is issued a real
  // per-workspace key (see /v1/admin/workspaces/rotate-key), this whole
  // branch should be deleted.
  const legacySecret = String(env.MBS_API_KEY || "");
  if (row.workspace_id === "mooral-main" && legacySecret && constantTimeText(suppliedKey, legacySecret)) {
    return row.workspace_id;
  }
  return null;
}

function parseScryptHash(stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) return null;
  if (N < 1024 || N > 1 << 20 || r < 1 || r > 64 || p < 1 || p > 16) return null;
  if (!/^[0-9a-f]+$/i.test(parts[4]) || !/^[0-9a-f]+$/i.test(parts[5])) return null;
  return { N, r, p, salt: Buffer.from(parts[4], "hex"), expected: Buffer.from(parts[5], "hex") };
}

function verifyPassword(password, stored) {
  const parsed = parseScryptHash(stored);
  if (!parsed) return Promise.resolve(false);
  return new Promise((resolve) => {
    scrypt(String(password), parsed.salt, parsed.expected.length, { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: 256 * 1024 * 1024 }, (error, derived) => {
      if (error || !derived || derived.length !== parsed.expected.length) return resolve(false);
      try { resolve(timingSafeEqual(derived, parsed.expected)); } catch { resolve(false); }
    });
  });
}

// ===================================================================
// Cloud reset (see 0006_workspace_reset_epoch.sql for why an epoch exists)
// ===================================================================
//
// BUSINESS_RESET_TABLES is deliberately NOT "every tenant table". A central
// business-data reset preserves:
//   - users / permission_profiles / profile_permissions / user_permissions
//     (who may log in, and what they may do -- otherwise every employee
//     would have to be re-invited to work after a data reset),
//   - employees (staff records are configuration, not ledger; the LOCAL
//     factory reset is the operation that removes them),
//   - company_settings (company identity, numbering, tax setup),
//   - audit_log / workspace_resets (the record of what happened).
// Each excluded table is a deliberate policy decision, not an oversight.
const BUSINESS_RESET_TABLES = [
  "notifications", "inventory_transactions", "transactions", "ledger_entries",
  "journal_entries", "certificates", "invoices", "orders", "mbs_messages",
  "customers", "products", "accounts"
];

async function readResetEpoch(env, workspace) {
  if (!workspace) return 0;
  try {
    const row = await env.DB.prepare("SELECT reset_epoch FROM workspaces WHERE workspace_id=?").bind(workspace).first();
    return Number(row && row.reset_epoch) || 0;
  } catch {
    // Before 0006 is applied the column does not exist; "never reset" is the
    // correct and safe reading of that state.
    return 0;
  }
}

// Refuses a write from a client whose last-known epoch is stale. A client
// that has never reset may omit the header entirely (backwards compatible);
// once a workspace HAS been reset, every write must state which epoch it is
// writing against, so an old installation cannot push pre-reset rows back.
// Reads are never blocked, so a stale client can always discover the new
// epoch and re-baseline itself.
async function resetEpochMismatch(request, env, workspace) {
  const header = request.headers.get("x-reset-epoch");
  const current = await readResetEpoch(env, workspace);
  if (header === null || header === "") {
    if (current === 0) return null;
    return json({ error: "reset_epoch_required", reset_epoch: current, message: "This workspace has been reset; send x-reset-epoch before writing." }, 409, request, env);
  }
  const claimed = Number(header);
  if (!Number.isSafeInteger(claimed) || claimed < 0) return json({ error: "invalid_reset_epoch" }, 400, request, env);
  if (claimed === current) return null;
  return json({
    error: "reset_epoch_mismatch",
    reset_epoch: current,
    message: "The central business data was reset since this device last synced. Re-baseline before writing."
  }, 409, request, env);
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY) throw new Error("Request body is too large.");
  const textBody = await request.text();
  if (textBody.length > MAX_BODY) throw new Error("Request body is too large.");
  if (!textBody) return {};
  return JSON.parse(textBody);
}

async function issueSession(env, userId, rememberMe = false) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expires = Math.floor(Date.now() / 1000) + (rememberMe ? 30 * 24 * 60 * 60 : SESSION_TTL);
  const expiresAt = new Date(expires * 1000).toISOString().slice(0, 19).replace("T", " ");
  await env.DB.prepare("INSERT INTO sessions(user_id,token_hash,remember_me,expires_at,created_at,last_used_at) VALUES(?,?,?,?,?,?)")
    .bind(userId, tokenHash, rememberMe ? 1 : 0, expiresAt, now(), now()).run();
  return { token, expiresAt: expires };
}

async function authUser(request, env) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token || token.length < 32) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT u.id,u.username,u.user_type,u.status,u.employee_id,u.permission_profile_id,
           u.must_change_password,u.locked_until,u.last_login_at,u.workspace_id,
           COALESCE(TRIM(e.first_name || ' ' || e.last_name), u.username) AS full_name,
           e.email,e.phone,e.designation,
           s.id AS session_id
    FROM sessions s
    JOIN users u ON u.id=s.user_id
    LEFT JOIN employees e ON e.id=u.employee_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP
    LIMIT 1`).bind(tokenHash).first();
  if (!row || row.status !== "active") return null;
  await env.DB.prepare("UPDATE sessions SET last_used_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.session_id).run();
  return row;
}

async function permissionKeys(env, user) {
  if (user.user_type === "owner" || user.user_type === "administrator") return null;
  const profile = user.permission_profile_id;
  const rows = await env.DB.prepare(`
    SELECT permission_key FROM profile_permissions WHERE profile_id=? AND allowed=1
    UNION
    SELECT permission_key FROM user_permissions WHERE user_id=? AND allowed=1`).bind(profile, user.id).all();
  const denied = await env.DB.prepare("SELECT permission_key FROM user_permissions WHERE user_id=? AND allowed=0").bind(user.id).all();
  const set = new Set((rows.results || []).map(x => String(x.permission_key)));
  for (const x of denied.results || []) set.delete(String(x.permission_key));
  return set;
}

async function can(user, env, collection, action) {
  if (!user) return false;
  if (user.user_type === "owner" || user.user_type === "administrator") return true;
  const module = COLLECTION_MODULE[collection];
  const permissionAction = ACTION_TO_PERMISSION[action];
  if (!module || !permissionAction) return false;
  const keys = await permissionKeys(env, user);
  return Boolean(keys && keys.has(`${module}.${permissionAction}`));
}

async function changePassword(request, env, user) {
  if (!user || request.method !== "POST") return text("Unauthorized.", 401, request, env);
  const d = await readJson(request);
  const currentPassword = String(d.currentPassword || "");
  const newPassword = String(d.newPassword || "");
  if (newPassword.length < 10 || newPassword.length > 256) return text("New password must be 10-256 characters.", 400, request, env);
  // user.id/user.workspace_id come from a DB row already matched by a
  // valid session (authUser()); the extra workspace_id filter below is
  // defense-in-depth, not the primary boundary -- it protects against a
  // future refactor accidentally passing the wrong user object in, not
  // against anything currently reachable from a request.
  const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id=? AND workspace_id=?").bind(user.id, user.workspace_id).first();
  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) return text("Current password is incorrect.", 401, request, env);
  const cryptoSalt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(cryptoSalt).map(x => x.toString(16).padStart(2, "0")).join("");
  const derived = await new Promise((resolve, reject) => {
    scrypt(newPassword, Buffer.from(saltHex, "hex"), 64, { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
  });
  const passwordHash = `scrypt$16384$8$1$${saltHex}$${Buffer.from(derived).toString("hex")}`;
  await env.DB.prepare("UPDATE users SET password_hash=?,must_change_password=0,failed_login_attempts=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(passwordHash, user.id, user.workspace_id).run();
  return json({ success: true }, 200, request, env);
}

async function handleAuth(request, env, path) {
  if (request.method === "POST" && path === "/v1/auth/login") {
    const d = await readJson(request);
    const workspace = workspaceForRequest(request, env);
    if (d.workspaceId && String(d.workspaceId) !== workspace) return text("Invalid workspace.", 400, request, env);
    const username = String(d.username || "").trim();
    const password = String(d.password || "");
    if (!username || !password) return text("Username and password are required.", 400, request, env);
    // Scoped to the claimed workspace: this only narrows WHICH row a
    // matching username+password can authenticate as, it does not grant
    // access by itself -- see the security-model note above
    // workspaceForRequest(). A username that exists in a different
    // workspace is invisible here, which is also what makes the same
    // username reusable across separate companies.
    const row = await env.DB.prepare("SELECT * FROM users WHERE workspace_id=? AND username=? LIMIT 1").bind(workspace, username).first();
    if (!row || row.status !== "active") return text("Invalid username or password.", 401, request, env);
    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) return text("Account temporarily locked.", 423, request, env);
    const valid = await verifyPassword(password, row.password_hash);
    if (!valid) {
      const attempts = Number(row.failed_login_attempts || 0) + 1;
      const locked = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
      await env.DB.prepare("UPDATE users SET failed_login_attempts=?,locked_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(attempts, locked, row.id).run();
      return text("Invalid username or password.", 401, request, env);
    }
    await env.DB.prepare("UPDATE users SET failed_login_attempts=0,locked_until=NULL,last_login_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.id).run();
    const session = await issueSession(env, row.id, Boolean(d.rememberMe));
    const user = await authUser(new Request(request.url, { headers: { authorization: `Bearer ${session.token}` } }), env);
    return json({ success: true, ...session, user: safeUser(user) }, 200, request, env);
  }
  if (request.method === "POST" && path === "/v1/auth/logout") {
    const user = await authUser(request, env);
    if (!user) return json({ success: true }, 200, request, env);
    const tokenHash = await sha256((request.headers.get("authorization") || "").slice(7));
    await env.DB.prepare("UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?").bind(tokenHash).run();
    return json({ success: true }, 200, request, env);
  }
  return null;
}

function safeUser(user) {
  if (!user) return null;
  return {
    id: user.id, username: user.username, fullName: user.full_name || user.username,
    userType: user.user_type, status: user.status, employeeId: user.employee_id,
    permissionProfileId: user.permission_profile_id, mustChangePassword: Boolean(user.must_change_password),
    email: user.email || "", phone: user.phone || "", designation: user.designation || ""
  };
}

async function handleUsers(request, env, user, apiKeyOk, workspace) {
  if (!workspace) return text("Unauthorized.", 401, request, env);
  if (request.method === "GET") {
    if (!apiKeyOk && (!user || (user.user_type !== "owner" && user.user_type !== "administrator"))) return text("Forbidden.", 403, request, env);
    const rows = await env.DB.prepare(`SELECT u.id,u.username,u.user_type,u.status,u.employee_id,u.permission_profile_id,u.must_change_password,u.updated_at,
      COALESCE(TRIM(e.first_name || ' ' || e.last_name), u.username) AS full_name,e.email,e.phone,e.designation
      FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.workspace_id=? ORDER BY u.user_type='owner' DESC, u.username`).bind(workspace).all();
    return json((rows.results || []).map(safeUser), 200, request, env);
  }
  if (request.method === "POST") {
    if (!apiKeyOk && (!user || user.user_type !== "owner")) return text("Forbidden.", 403, request, env);
    if (apiKeyOk) {
      const epochResponse = await resetEpochMismatch(request, env, workspace);
      if (epochResponse) return epochResponse;
    }
    const d = await readJson(request);
    const username = String(d.username || "").trim();
    const passwordHash = String(d.password_hash || "");
    const userType = String(d.user_type || "employee");
    const status = String(d.status || "active");
    // Local MBS SQLite's `users.username` has no character-format
    // constraint -- the desktop app's own first-time-setup wizard and
    // user-management UI only enforce a minimum length (>=3) and trim
    // whitespace (see src/components/auth/first-time-setup-wizard.tsx).
    // Real usernames routinely include things like "owner@company.com" or
    // "Amin Rahman". This endpoint's old `^[A-Za-z0-9._-]{2,80}$` whitelist
    // was stricter than what the app actually allows to be created, so any
    // such username made every upsertCloudUser() call throw a 400 here --
    // silently blocking this user (and, transitively, the whole
    // syncUsersAndPermissions() batch -- see cloud-sync-manager.ts) from
    // ever reaching D1. The check below matches local's real constraint
    // (non-empty after trim, sane length bound) instead of an arbitrary
    // slug-style pattern; SQL injection is not a risk here since every
    // query in this file uses parameterized `?` bindings, never string
    // interpolation of user input.
    if (!username || username.length > 120 || /[\u0000-\u001f\u007f]/.test(username) || !passwordHash || !["owner","administrator","employee"].includes(userType) || !["active","disabled","archived"].includes(status)) return text("Invalid user data.", 400, request, env);
    if (userType === "owner" && !apiKeyOk && user?.user_type !== "owner") return text("Forbidden.", 403, request, env);
    // Scoped to the derived workspace -- NOT global. Two different
    // companies can each have their own "admin"; this is what actually
    // enables that (0002 already added the composite index; the fully
    // global UNIQUE(username) constraint is relaxed in 0003).
    const existing = await env.DB.prepare("SELECT id FROM users WHERE workspace_id=? AND username=? LIMIT 1").bind(workspace, username).first();
    if (existing) {
      await env.DB.prepare(`UPDATE users SET password_hash=?,status=?,employee_id=?,permission_profile_id=?,must_change_password=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?`)
        .bind(passwordHash, status, d.employee_id ?? null, d.permission_profile_id ?? null, Number(d.must_change_password || 0), existing.id, workspace).run();
      return json({ success: true, id: existing.id, updated: true }, 200, request, env);
    }
    try {
      const result = await env.DB.prepare(`INSERT INTO users(user_type,username,password_hash,must_change_password,status,employee_id,permission_profile_id,created_by,updated_at,workspace_id) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)`)
        .bind(userType, username, passwordHash, Number(d.must_change_password || 0), status, d.employee_id ?? null, d.permission_profile_id ?? null, user?.id ?? null, workspace).run();
      return json({ success: true, id: result.meta.last_row_id, created: true }, 201, request, env);
    } catch (err) {
      // The pre-check above only looked within THIS workspace (correct --
      // that's the whole point of per-workspace usernames), but until
      // 0003_workspace_unique_constraints.sql relaxes users.username from
      // a global UNIQUE constraint to UNIQUE(workspace_id, username), the
      // underlying column can still reject a username already used by a
      // DIFFERENT workspace. That's a real, tracked, pre-0003 limitation
      // (see that migration's header) -- surfaced here as a clean 409,
      // not an unhandled DB exception.
      const message = String(err && err.message || err);
      if (/UNIQUE constraint failed:\s*users\.username/i.test(message)) {
        return json({ error: "username_conflict", username, message: "That username is already in use. (Until per-workspace username uniqueness ships, usernames must be unique across all workspaces, not just this one.)" }, 409, request, env);
      }
      throw err;
    }
  }
  return text("Method not allowed.", 405, request, env);
}

async function handlePermissionSync(request, env, apiKeyOk, workspace) {
  if (!apiKeyOk || !workspace || request.method !== "POST") return text("Forbidden.", 403, request, env);
  const epochResponse = await resetEpochMismatch(request, env, workspace);
  if (epochResponse) return epochResponse;
  const d = await readJson(request);
  const profiles = Array.isArray(d.profiles) ? d.profiles : [];
  const profilePermissions = Array.isArray(d.profilePermissions) ? d.profilePermissions : [];
  const userPermissions = Array.isArray(d.userPermissions) ? d.userPermissions : [];
  // profile_id / user_id below are local D1 autoincrement ids scoped to
  // THIS workspace's own users/permission_profiles rows (guaranteed by the
  // ownership checks against `workspace` in each loop) -- a profile_id or
  // user_id from a different, more populous workspace happening to share
  // the same integer value cannot cross over here, because every write is
  // additionally gated on that row actually belonging to `workspace`.
  for (const p of profiles) {
    if (!Number.isInteger(Number(p.id)) || !String(p.name || "")) continue;
    const owns = await env.DB.prepare("SELECT id FROM permission_profiles WHERE id=? AND workspace_id=?").bind(Number(p.id), workspace).first();
    if (!owns) {
      await env.DB.prepare(`INSERT INTO permission_profiles(id,name,description,is_system,created_at,updated_at,workspace_id) VALUES(?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?)`)
        .bind(Number(p.id), String(p.name), String(p.description || ""), Number(p.is_system || 0), workspace).run();
      continue;
    }
    await env.DB.prepare(`UPDATE permission_profiles SET name=?,description=?,is_system=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?`)
      .bind(String(p.name), String(p.description || ""), Number(p.is_system || 0), Number(p.id), workspace).run();
  }
  for (const p of profilePermissions) {
    if (!Number.isInteger(Number(p.profile_id)) || !String(p.permission_key || "")) continue;
    const owns = await env.DB.prepare("SELECT id FROM permission_profiles WHERE id=? AND workspace_id=?").bind(Number(p.profile_id), workspace).first();
    if (!owns) continue;
    await env.DB.prepare(`INSERT INTO profile_permissions(profile_id,permission_key,allowed) VALUES(?,?,?)
      ON CONFLICT(profile_id,permission_key) DO UPDATE SET allowed=excluded.allowed`)
      .bind(Number(p.profile_id), String(p.permission_key), Number(p.allowed ? 1 : 0)).run();
  }
  for (const p of userPermissions) {
    if (!Number.isInteger(Number(p.user_id)) || !String(p.permission_key || "")) continue;
    const owns = await env.DB.prepare("SELECT id FROM users WHERE id=? AND workspace_id=?").bind(Number(p.user_id), workspace).first();
    if (!owns) continue;
    await env.DB.prepare(`INSERT INTO user_permissions(user_id,permission_key,allowed) VALUES(?,?,?)
      ON CONFLICT(user_id,permission_key) DO UPDATE SET allowed=excluded.allowed`)
      .bind(Number(p.user_id), String(p.permission_key), Number(p.allowed ? 1 : 0)).run();
  }
  return json({ success: true, profiles: profiles.length, profilePermissions: profilePermissions.length, userPermissions: userPermissions.length }, 200, request, env);
}

// Uses `mbs_messages`, NOT the legacy `messages` table. Production's
// `messages` table pre-dates MBS, has an incompatible column shape
// (id, sender, receiver, message, updated_at, created_at), and holds a
// real row that must never be touched by this Worker. See the note at the
// top of cloudflare/migrations/0001_mbs_core_schema.sql.
// Resolves the effective sender for a messaging request. Bearer sessions
// (the web portal) already carry a full, DB-verified `user`. The desktop
// app authenticates purely with a workspace API key (see cloud-client.ts:
// it never sends an Authorization header at all) and identifies the local
// sender via an `x-user` username hint -- which, same as workspaceForRequest,
// is only a CLAIM until it's resolved against a real, active row in the
// already-verified `workspace`. A forged x-user for a username that
// doesn't exist (or belongs to a different workspace, impossible here
// since the lookup itself is workspace-scoped) simply resolves to null and
// the request is rejected below, same as no user at all.
async function resolveMessageSender(request, env, user, workspace) {
  if (user) return user;
  if (!workspace) return null;
  const claimedUsername = String(request.headers.get("x-user") || "").trim();
  if (!claimedUsername) return null;
  const row = await env.DB.prepare(`
    SELECT u.id,u.username,u.user_type,u.status,u.workspace_id,
           COALESCE(TRIM(e.first_name || ' ' || e.last_name), u.username) AS full_name
    FROM users u LEFT JOIN employees e ON e.id=u.employee_id
    WHERE u.workspace_id=? AND u.username=? LIMIT 1`).bind(workspace, claimedUsername).first();
  if (!row || row.status !== "active") return null;
  return row;
}

async function handleMessages(request, env, user, apiKeyOk, workspace) {
  const sender = await resolveMessageSender(request, env, user, workspace);
  if (!sender || !workspace) return text("Authentication required.", 401, request, env);
  if (request.method === "GET") {
    const rows = await env.DB.prepare(`SELECT id,sender_id,sender_name,recipient_id,recipient_name,subject,body,category,parent_message_id,is_read,deleted_by_sender,deleted_by_recipient,created_at,updated_at
      FROM mbs_messages WHERE workspace_id=? AND ((sender_id=? AND deleted_by_sender=0) OR (recipient_id=? AND deleted_by_recipient=0)) ORDER BY created_at DESC LIMIT 500`).bind(workspace, sender.id, sender.id).all();
    return json(rows.results || [], 200, request, env);
  }
  if (request.method === "POST") {
    const d = await readJson(request);
    const recipientId = Number(d.recipient_id);
    if (!Number.isInteger(recipientId) || recipientId < 1) return text("Recipient is required.", 400, request, env);
    // Scoped to `workspace`: a recipient id that only exists in a
    // different workspace (even if the integer happens to collide) will
    // simply not be found here -- this is the messaging-specific instance
    // of the same tenant boundary every other table now enforces.
    const recipient = await env.DB.prepare("SELECT id,username,user_type FROM users WHERE id=? AND workspace_id=? AND status='active'").bind(recipientId, workspace).first();
    if (!recipient) return text("Recipient not found.", 404, request, env);
    // SECURITY: enforce the Employee -> Employee block server-side too,
    // not only in the desktop app's own messaging-manager.ts. The Worker
    // is the actual trust boundary -- a modified/repackaged client could
    // skip the local check and call this endpoint directly, so it must not
    // be possible to reach a disallowed recipient through this path either.
    if (sender.user_type === "employee" && recipient.user_type === "employee") {
      return text("Employees can only message administrators or the owner.", 403, request, env);
    }
    const subject = String(d.subject || "").trim().slice(0, 200);
    const body = String(d.body || "").trim().slice(0, 10000);
    if (!subject || !body) return text("Subject and message are required.", 400, request, env);
    const stamp = now();
    const result = await env.DB.prepare(`INSERT INTO mbs_messages(sender_id,sender_name,recipient_id,recipient_name,subject,body,category,parent_message_id,created_at,updated_at,workspace_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(sender.id, sender.full_name || sender.username, recipient.id, recipient.username, subject, body, String(d.category || "general"), d.parent_message_id ?? null, stamp, stamp, workspace).run();
    return json({ success: true, id: result.meta.last_row_id }, 201, request, env);
  }
  if (request.method === "PATCH") {
    const id = Number(new URL(request.url).pathname.split("/").pop());
    if (!Number.isInteger(id)) return text("Invalid message ID.", 400, request, env);
    const d = await readJson(request);
    const message = await env.DB.prepare("SELECT * FROM mbs_messages WHERE id=? AND workspace_id=?").bind(id, workspace).first();
    if (!message || (message.sender_id !== sender.id && message.recipient_id !== sender.id)) return text("Message access denied.", 403, request, env);
    const sets = [], values = [];
    if (d.is_read !== undefined && message.recipient_id === sender.id) { sets.push("is_read=?"); values.push(d.is_read ? 1 : 0); }
    if (d.deleted === true) { sets.push(message.sender_id === sender.id ? "deleted_by_sender=?" : "deleted_by_recipient=?"); values.push(1); }
    if (!sets.length) return json({ success: true }, 200, request, env);
    sets.push("updated_at=CURRENT_TIMESTAMP"); values.push(id); values.push(workspace);
    await env.DB.prepare(`UPDATE mbs_messages SET ${sets.join(",")} WHERE id=? AND workspace_id=?`).bind(...values).run();
    return json({ success: true }, 200, request, env);
  }
  return text("Method not allowed.", 405, request, env);
}

const COMPANY_SETTINGS_COLUMNS = [
  "company_name", "business_type", "owner_name", "phone", "mobile", "email", "website", "address", "city",
  "state", "postal_code", "country", "trade_license", "registration_number", "bin_vat", "tin", "currency",
  "timezone", "financial_year", "company_description", "invoice_footer", "report_footer", "notes", "logo_path",
  "tax_rate", "invoice_prefix", "payment_terms", "language", "theme", "certificate_employee_prefix",
  "certificate_product_prefix", "certificate_auto_numbering", "certificate_qr_verification",
  "certificate_authorized_signature", "certificate_authorized_designation", "certificate_footer_text",
  "certificate_enable_expiry", "certificate_default_validity_days", "certificate_default_template",
  "certificate_reuse_company_logo", "business_mode", "security_max_login_attempts", "security_lockout_minutes",
  "security_session_timeout_minutes", "stock_low_threshold", "stock_default_warehouse", "stock_allow_negative",
  "stock_auto_reorder_alert", "sales_order_prefix", "purchase_order_prefix", "sales_default_payment_terms",
  "purchase_default_payment_terms", "sales_require_approval", "fiscal_year_start", "accounting_default_tax_rate",
  "accounting_default_payment_method", "accounting_auto_post_journal", "payroll_pay_day", "payroll_salary_cycle",
  "employee_probation_days", "payroll_overtime_rate", "notify_email_enabled", "notify_low_stock",
  "notify_order_updates", "notify_payment_due", "integration_api_key", "integration_webhook_url",
  "integration_enabled", "invoice_template_style", "report_template_style", "document_show_logo",
  "date_format", "number_format"
]; // logo_blob/logo_mime intentionally excluded — binary local asset, same convention as employee photo_blob/photo_mime.

async function handleCompanySettings(request, env, workspace) {
  if (!workspace) return text("Unauthorized.", 401, request, env);
  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT * FROM company_settings WHERE workspace_id=?").bind(workspace).first();
    return json(row || {}, 200, request, env);
  }
  if (request.method === "DELETE") return text("Company settings cannot be deleted.", 405, request, env);
  if (request.method !== "POST" && request.method !== "PATCH") return text("Method not allowed.", 405, request, env);
  const d = await readJson(request);
  if (!d || typeof d !== "object" || Array.isArray(d)) return text("Record must be an object.", 400, request, env);
  const columns = request.method === "POST"
    ? COMPANY_SETTINGS_COLUMNS
    : COMPANY_SETTINGS_COLUMNS.filter(c => Object.prototype.hasOwnProperty.call(d, c));
  if (!columns.length) return json({ success: true }, 200, request, env);
  // D1 caps bound parameters at 100 per query (SQLITE_LIMIT_VARIABLE_NUMBER=100;
  // see https://developers.cloudflare.com/d1/platform/limits/). With 81
  // company_settings columns, binding the values array twice (once for the
  // INSERT list, once again for a literal "col=?" UPDATE SET) produced 162
  // params and triggered "D1_ERROR: too many SQL variables". Referencing the
  // pseudo-table `excluded` in the SET clause (same pattern already used by
  // every other table's upsert in this file) needs the values bound only
  // once, so this stays well under the limit even if columns are added later.
  //
  // Upsert target is workspace_id, not id: this requires
  // 0003_workspace_unique_constraints.sql to have run (it recreates
  // company_settings without the old `CHECK (id = 1)` singleton
  // constraint, which otherwise makes a second workspace's INSERT fail
  // outright -- see the note in that migration). Until 0003 ships, any
  // workspace other than 'mooral-main' gets a loud, visible D1 constraint
  // error here rather than silently overwriting another tenant's settings.
  const insertPlaceholders = columns.map(() => "?").join(",");
  const updateSet = columns.map(c => `${c}=excluded.${c}`).join(",");
  const values = columns.map(c => (d[c] === undefined ? null : d[c]));
  await env.DB.prepare(
    `INSERT INTO company_settings(workspace_id,${columns.join(",")}) VALUES(?,${insertPlaceholders})
     ON CONFLICT(workspace_id) DO UPDATE SET ${updateSet}`
  ).bind(workspace, ...values).run();
  return json({ success: true }, 200, request, env);
}

async function handleData(request, env, user, apiKeyOk, collection, id, workspace) {
  if (!workspace) return text("Unauthorized.", 401, request, env);
  if (!ALLOWED_COLLECTIONS.has(collection)) return text("Unsupported collection.", 400, request, env);
  const action = request.method === "GET" ? "read" : request.method === "POST" ? "create" : request.method === "PATCH" ? "edit" : request.method === "DELETE" ? "delete" : null;
  if (!action) return text("Method not allowed.", 405, request, env);
  if (!apiKeyOk && !(await can(user, env, collection, action))) return text("Forbidden.", 403, request, env);
  // Stale-device guard for writes only (see 0006). Reads stay open so a
  // client can always discover the current epoch and re-baseline.
  if (request.method !== "GET") {
    const epochResponse = await resetEpochMismatch(request, env, workspace);
    if (epochResponse) return epochResponse;
  }

  if (collection === "company_settings") return handleCompanySettings(request, env, workspace);

  // These already have dedicated, fuller-featured relational endpoints
  // (see handleUsers / handlePermissionSync). Routing them through the
  // generic path too would let two different code paths write the same
  // tables inconsistently, so it's refused here rather than silently
  // duplicated.
  if (["users", "permission_profiles", "user_permissions", "profile_permissions"].includes(collection)) {
    return text(`Collection '${collection}' is served by a dedicated endpoint (/v1/users or /v1/admin/permissions/sync), not /v1/data/${collection}.`, 400, request, env);
  }

  const columns = TABLE_SCHEMAS[collection];
  if (!columns) return text("Unsupported collection.", 400, request, env);

  if (request.method === "GET") {
    if (id) {
      const row = await env.DB.prepare(`SELECT * FROM ${collection} WHERE workspace_id=? AND local_id=?`).bind(workspace, id).first();
      if (!row) return text("Record not found.", 404, request, env);
      return json(row, 200, request, env);
    }
    const params = new URL(request.url).searchParams;
    const limit = Math.min(Math.max(Number(params.get("limit") || 500), 1), 2000);
    const since = params.get("since");
    // Incremental pull (?since=...): includes soft-deleted rows (tombstones)
    // so a puller can detect and apply a delete that happened on another
    // device -- see 0005_sync_tombstones.sql. Plain browsing (no ?since=)
    // excludes them, matching how a normal "list my records" call should
    // behave for anything other than the sync engine itself.
    //
    // INCLUSIVE (>=), not exclusive (>): SQLite's CURRENT_TIMESTAMP has
    // only whole-SECOND resolution, no fractional part. Two genuinely
    // different writes landing in the same second (very plausible --
    // confirmed to actually happen in
    // tests/main/entry-bidirectional-sync.ts, not just theoretically,
    // once several devices push/pull within the same test run) would
    // otherwise let `updated_at > cursor` silently miss a real update
    // that happens to share a timestamp with the puller's own cursor.
    // Using >= means the boundary row(s) can be re-fetched on the next
    // page, which is safe and cheap: applyPulledRow()'s existing
    // stale/out-of-order guard (`cloudRevision <= existingMapping.
    // revision`) already deduplicates by sync_revision, not by trusting
    // the cursor to be a hard exclusive boundary -- so a handful of
    // harmless re-fetched rows cost a little redundant work, never a
    // missed update.
    const rows = since
      ? await env.DB.prepare(`SELECT * FROM ${collection} WHERE workspace_id=? AND updated_at >= ? ORDER BY updated_at ASC LIMIT ?`).bind(workspace, since, limit).all()
      : await env.DB.prepare(`SELECT * FROM ${collection} WHERE workspace_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?`).bind(workspace, limit).all();
    return json({ rows: rows.results || [], count: rows.results?.length || 0 }, 200, request, env);
  }

  const d = await readJson(request);
  if (!d || typeof d !== "object" || Array.isArray(d)) return text("Record must be an object.", 400, request, env);
  const recordLocalId = id || String(d.id ?? crypto.randomUUID());
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(recordLocalId)) return text("Invalid record ID.", 400, request, env);

  if (request.method === "POST") {
    const values = columns.map(c => (d[c] === undefined ? null : d[c]));
    const insertPlaceholders = columns.map(() => "?").join(",");
    // updated_at/sync_revision are Worker-owned bookkeeping, never
    // client-supplied: a device cannot claim its own write happened
    // "later" than it really did, and cannot invent a revision number to
    // force acceptIfCurrent() into treating a stale write as current.
    try {
      await env.DB.prepare(
        `INSERT INTO ${collection}(workspace_id,local_id,${columns.join(",")},updated_at,sync_revision) VALUES(?,?,${insertPlaceholders},CURRENT_TIMESTAMP,1)
         ON CONFLICT(workspace_id,local_id) DO UPDATE SET ${columns.map(c => `${c}=excluded.${c}`).join(",")},updated_at=CURRENT_TIMESTAMP,sync_revision=sync_revision+1,deleted_at=NULL`
      ).bind(workspace, recordLocalId, ...values).run();
      const stored = await env.DB.prepare(`SELECT updated_at, sync_revision FROM ${collection} WHERE workspace_id=? AND local_id=?`).bind(workspace, recordLocalId).first();
      // sync_revision === 1 can only mean the INSERT branch ran (the
      // UPDATE branch always increments past 1) -- used here purely to
      // pick the right HTTP status, not as a security-relevant check.
      const wasFreshInsert = Number(stored?.sync_revision) === 1;
      return json({ success: true, id: recordLocalId, updated_at: stored?.updated_at, sync_revision: stored?.sync_revision }, wasFreshInsert ? 201 : 200, request, env);
    } catch (err) {
      // A UNIQUE-constraint failure here means a business key generated
      // independently on another device (e.g. product_id "PRD-000001")
      // collides with a DIFFERENT record already in D1 -- NOT the same
      // record being re-synced (that case is handled by the
      // (workspace_id, local_id) ON CONFLICT above). MBS's local id
      // generators are per-device and were never designed to be
      // collision-proof across devices, so this is a real, expected
      // possibility, not a bug. Reporting it as a clear 409 (rather than
      // crashing, silently overwriting the other device's record, or
      // losing this one) is deliberate: resolving which of the two
      // colliding business codes should change is a business decision for
      // a person, not something to guess at here.
      //
      // NOTE: until 0003_workspace_unique_constraints.sql is applied, the
      // underlying business-key columns (product_id, customer_id, etc.)
      // are still GLOBALLY unique, not per-workspace -- so this 409 can
      // currently also fire for a collision against a DIFFERENT
      // workspace's record, not only a same-workspace one. That's a
      // business/UX limitation (a legitimate code gets blocked
      // unnecessarily), not a security issue: no cross-tenant data is
      // read or written here, the write is simply refused.
      const message = String(err && err.message || err);
      // SQLite reports a composite UNIQUE violation as a comma-separated
      // list of every column in the constraint (e.g.
      // "invoices.workspace_id, invoices.order_id" for the
      // idx_invoices_workspace_order_id partial unique index added in
      // 0002) -- capturing only the FIRST one previously misreported the
      // conflict as being on "workspace_id" for any table with a
      // workspace-scoped composite index, which is never the actually
      // useful column to show. Every composite unique index in this
      // schema puts workspace_id first and the real business column
      // last, so the last entry in the list is always the right one to
      // report; single-column constraints (still the case for
      // product_id/customer_id/employee_number/transaction_id/code until
      // 0003_workspace_unique_constraints.sql ships) have exactly one
      // entry, so this also does the right thing for those unchanged.
      const match = message.match(/UNIQUE constraint failed:\s*([\w.,\s]+)/i);
      if (match) {
        const columnEntries = match[1].split(",").map(entry => entry.trim());
        const lastEntry = columnEntries[columnEntries.length - 1];
        const [, conflictColumn] = lastEntry.split(".");
        return json({
          error: "business_key_conflict",
          collection,
          column: conflictColumn,
          value: d[conflictColumn] ?? null,
          local_id: recordLocalId,
          message: `Another record already uses this ${conflictColumn}. This usually means two devices generated the same code before either had synced. Not applied -- needs manual resolution.`
        }, 409, request, env);
      }
      throw err;
    }
    // the return already happened inside the try block above.
  }

  if (!id) return text("Record ID required.", 400, request, env);

  if (request.method === "PATCH") {
    const existing = await env.DB.prepare(`SELECT id, sync_revision FROM ${collection} WHERE workspace_id=? AND local_id=?`).bind(workspace, id).first();
    if (!existing) return text("Record not found.", 404, request, env);
    // Optimistic-concurrency conflict check, matching
    // sync-conflict-service.ts's acceptIfCurrent(): if the caller tells us
    // which revision it last saw (expected_revision) and that no longer
    // matches what's actually stored, someone else changed this record in
    // between -- reject with 409 rather than silently overwriting a
    // newer write neither side has seen yet ("no silent overwrite of
    // newer data", brief section 7). expected_revision is optional so a
    // fresh local record that was never pulled from cloud (has no prior
    // revision to compare against) can still push its first update
    // normally.
    if (d.expected_revision !== undefined && Number(d.expected_revision) !== Number(existing.sync_revision)) {
      const currentRow = await env.DB.prepare(`SELECT * FROM ${collection} WHERE workspace_id=? AND local_id=?`).bind(workspace, id).first();
      return json({
        error: "revision_conflict",
        collection,
        local_id: id,
        expected_revision: Number(d.expected_revision),
        current_revision: Number(existing.sync_revision),
        current: currentRow,
        message: "This record changed elsewhere since you last saw it. Not applied -- needs conflict resolution."
      }, 409, request, env);
    }
    const presentColumns = columns.filter(c => Object.prototype.hasOwnProperty.call(d, c));
    if (!presentColumns.length) return json({ success: true, sync_revision: existing.sync_revision }, 200, request, env);
    const setClause = presentColumns.map(c => `${c}=?`).join(",");
    const values = presentColumns.map(c => d[c]);
    await env.DB.prepare(`UPDATE ${collection} SET ${setClause},updated_at=CURRENT_TIMESTAMP,sync_revision=sync_revision+1,deleted_at=NULL WHERE workspace_id=? AND local_id=?`).bind(...values, workspace, id).run();
    const updated = await env.DB.prepare(`SELECT updated_at, sync_revision FROM ${collection} WHERE workspace_id=? AND local_id=?`).bind(workspace, id).first();
    return json({ success: true, updated_at: updated?.updated_at, sync_revision: updated?.sync_revision }, 200, request, env);
  }

  const result = await env.DB.prepare(`UPDATE ${collection} SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,sync_revision=sync_revision+1 WHERE workspace_id=? AND local_id=? AND deleted_at IS NULL`).bind(workspace, id).run();
  return result.meta.changes ? json({ success: true }, 200, request, env) : text("Record not found.", 404, request, env);
}

// Provisions a brand-new customer workspace. Gated by env.MBS_ADMIN_KEY, a
// SEPARATE secret from any customer's per-workspace API key -- only Mooral
// (the vendor) holds this, never a customer installation. This is the
// "Activation Generator/license -> workspace identity" lifecycle step: a
// new customer must get a genuinely new, random workspace_id (never
// 'mooral-main', and the caller cannot choose an existing id -- INSERT
// fails on the workspaces PK if they try), plus a freshly generated API
// key that is returned to the caller EXACTLY ONCE in plaintext (only its
// scrypt hash is ever stored) for embedding into that customer's
// Activation Generator-issued license (licensedCloudConfig.workspaceId /
// .apiKey). Losing the plaintext after this response means it must be
// rotated, not recovered -- same as any password.
async function handleAdminCreateWorkspace(request, env) {
  if (request.method !== "POST") return text("Method not allowed.", 405, request, env);
  const adminKey = String(env.MBS_ADMIN_KEY || "");
  const supplied = String(request.headers.get("x-admin-key") || "");
  if (!adminKey || !supplied || !constantTimeText(supplied, adminKey)) return text("Forbidden.", 403, request, env);
  const d = await readJson(request);
  const workspaceId = String(d.workspaceId || "").trim();
  const name = String(d.name || "").trim();
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(workspaceId)) return text("workspaceId must be 3-80 chars, letters/digits/_/- only.", 400, request, env);
  if (workspaceId === "mooral-main") return text("That workspace id is reserved.", 400, request, env);
  const apiKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const apiKey = Array.from(apiKeyBytes).map(x => x.toString(16).padStart(2, "0")).join("");
  const cryptoSalt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(cryptoSalt).map(x => x.toString(16).padStart(2, "0")).join("");
  const derived = await new Promise((resolve, reject) => {
    scrypt(apiKey, Buffer.from(saltHex, "hex"), 64, { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
  });
  const apiKeyHash = `scrypt$16384$8$1$${saltHex}$${Buffer.from(derived).toString("hex")}`;
  try {
    await env.DB.prepare("INSERT INTO workspaces(workspace_id,name,api_key_hash,status) VALUES(?,?,?,'active')").bind(workspaceId, name, apiKeyHash).run();
  } catch (err) {
    const message = String(err && err.message || err);
    if (/UNIQUE constraint failed/i.test(message)) return text("A workspace with that id already exists.", 409, request, env);
    throw err;
  }
  return json({ success: true, workspaceId, apiKey }, 201, request, env);
}

// The employee client (MBS-user) has no local database and no copy of the
// permission catalog: it reads its effective grants from here, and the
// Worker re-evaluates them on every request via can(). This endpoint is
// therefore a UI hint -- hiding a module because the list says so is a
// usability measure, never the security boundary. Verified by
// tests/main/entry-mbs-user.ts, which calls a forbidden endpoint directly
// with a valid employee session and expects 403 from the Worker.
async function handleMyPermissions(request, env, user) {
  if (!user) return text("Unauthorized.", 401, request, env);
  const keys = await permissionKeys(env, user);
  return json({
    success: true,
    user: safeUser(user),
    unrestricted: keys === null,
    permissions: keys === null ? [] : Array.from(keys).sort(),
    resetEpoch: await readResetEpoch(env, user.workspace_id)
  }, 200, request, env);
}

// Owner-only central reset. apiKeyOk is the gate -- the workspace key only
// exists on the owner's installation, so an employee (or administrator)
// Bearer session can never reach this even if the client is modified.
async function handleAdminReset(request, env, apiKeyOk, workspace) {
  if (!workspace) return text("Unauthorized.", 401, request, env);
  if (!apiKeyOk) return text("Forbidden: the workspace API key is required to reset central data.", 403, request, env);
  const d = await readJson(request);
  // The confirmation is the workspace id itself, typed by the owner. A
  // mistyped or replayed request with a different id changes nothing.
  if (String(d.confirm || "") !== workspace) return text("Confirmation does not match the workspace.", 400, request, env);
  if (String(d.scope || "business") !== "business") return text("Unsupported reset scope.", 400, request, env);

  // Order matters: bump the epoch FIRST. If the process dies half-way
  // through the deletes below, every synced device is already barred from
  // writing its stale copy back, and the reset can simply be retried --
  // the alternative order would leave a window in which a device could
  // recreate pre-reset rows while the deletion was still running.
  let resetEpoch = 0;
  try {
    await env.DB.prepare("UPDATE workspaces SET reset_epoch=reset_epoch+1 WHERE workspace_id=?").bind(workspace).run();
    resetEpoch = await readResetEpoch(env, workspace);
  } catch (error) {
    // 0006 not applied: refuse rather than delete data without the guard
    // that makes the reset stick.
    return text(`Cloud reset requires migration 0006_workspace_reset_epoch.sql (${error instanceof Error ? error.message : String(error)}).`, 409, request, env);
  }

  const deleted = {};
  for (const table of BUSINESS_RESET_TABLES) {
    const result = await env.DB.prepare(`DELETE FROM ${table} WHERE workspace_id=?`).bind(workspace).run();
    deleted[table] = Number(result && result.meta && result.meta.changes) || 0;
  }

  // workspace_resets is the support-facing record and intentionally lives
  // outside the tenant tables a reset clears (see the migration header).
  await env.DB.prepare("INSERT INTO workspace_resets(workspace_id,scope,reset_epoch,requested_by,deleted_counts) VALUES(?,?,?,?,?)")
    .bind(workspace, "business", resetEpoch, "workspace-api-key", JSON.stringify(deleted)).run();

  return json({ success: true, scope: "business", workspaceId: workspace, resetEpoch, deleted }, 200, request, env);
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "OPTIONS") {
    const headers = new Headers(); applyCors(headers, request, env); return new Response(null, { status: 204, headers });
  }
  if (request.method === "GET" && path === "/health") return json({ ok: true, service: "Mooral Business Suite Cloud API", database: "D1", time: now() }, 200, request, env);
  if (path === "/v1/admin/workspaces") return handleAdminCreateWorkspace(request, env);
  try {
    const authResponse = await handleAuth(request, env, path);
    if (authResponse) return authResponse;
    const authenticatedUser = await authUser(request, env);
    if (path === "/v1/auth/change-password") return changePassword(request, env, authenticatedUser);
    // Two independent, mutually-reinforcing ways to establish workspace
    // identity -- see the security-model note above workspaceForRequest().
    // Neither trusts the client-supplied header by itself; both require a
    // matching secret (a session token proven by prior login, or an API
    // key hash-verified against that exact workspace).
    const apiKeyWorkspace = await resolveWorkspaceForApiKey(request, env);
    const apiKeyOk = apiKeyWorkspace !== null;
    const user = authenticatedUser;
    const workspace = user ? user.workspace_id : apiKeyWorkspace;
    if (!user && !apiKeyOk) return text("Unauthorized.", 401, request, env);
    if (path === "/v1/me" && request.method === "GET") return json({ success: true, user: safeUser(user) }, 200, request, env);
    if (path === "/v1/me/permissions" && request.method === "GET") return await handleMyPermissions(request, env, user);
    // Lets any authenticated client (desktop sync engine, MBS-user) discover
    // the current reset epoch. Deliberately readable with either credential
    // and never blocked by a stale epoch -- this is how a client recovers.
    if (path === "/v1/workspace" && request.method === "GET") return json({ success: true, workspaceId: workspace, resetEpoch: await readResetEpoch(env, workspace) }, 200, request, env);
    if (path === "/v1/admin/reset" && request.method === "POST") return await handleAdminReset(request, env, apiKeyOk, workspace);
    // NOTE: these are all `await`ed rather than `return`ed directly, even
    // though the effect on the successful path is identical. Returning an
    // async function's promise straight out of this try block WITHOUT
    // awaiting it first means the try/catch below only wraps the
    // synchronous act of calling the handler, not its actual execution --
    // any rejection the handler produces later (e.g. a raw DB constraint
    // error) would propagate completely unhandled instead of being turned
    // into the clean error response below. Confirmed as a real, previously
    // latent bug by tests/main/entry-worker-tenant-isolation.ts (a genuine
    // UNIQUE-constraint collision in handleUsers surfaced as an unhandled
    // rejection, not a 400/409 response, before this fix).
    if (path === "/v1/users") return await handleUsers(request, env, user, apiKeyOk, workspace);
    if (path === "/v1/admin/permissions/sync") return await handlePermissionSync(request, env, apiKeyOk, workspace);
    if (path === "/v1/messages" || /^\/v1\/messages\/\d+$/.test(path)) return await handleMessages(request, env, user, apiKeyOk, workspace);
    const match = path.match(/^\/v1\/data\/([A-Za-z_][A-Za-z0-9_]*)(?:\/([^/]+))?$/);
    if (match) return await handleData(request, env, user, apiKeyOk, match[1], match[2] ? decodeURIComponent(match[2]) : null, workspace);
    if (path === "/v1/online/status" && request.method === "GET") return json({ online: true, database: "D1" }, 200, request, env);
    return text("Not found.", 404, request, env);
  } catch (error) {
    console.error(error);
    return text(error instanceof Error ? error.message : "Internal server error.", 400, request, env);
  }
}

export default { fetch: handle };
