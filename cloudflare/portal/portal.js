const API = window.location.origin;
const $ = (id) => document.getElementById(id);
let session = JSON.parse(localStorage.getItem('mbs_session') || 'null');
function setSession(s){session=s;localStorage.setItem('mbs_session',JSON.stringify(s));}
function clearSession(){session=null;localStorage.removeItem('mbs_session');}
function headers(){return session ? {Authorization:`Bearer ${session.token}`} : {};}
async function api(path,opt={}){
  const r=await fetch(API+path,{...opt,headers:{'content-type':'application/json',...headers(),...(opt.headers||{})}});
  if(!r.ok) throw Error(await r.text()||`HTTP ${r.status}`);
  return r.json();
}
function render(){
  if(!session){$('login').classList.remove('hidden');$('home').classList.add('hidden');return;}
  $('login').classList.add('hidden');$('home').classList.remove('hidden');
  $('identity').textContent=`${session.user.fullName} · ${session.user.userType}`;
  if(session.user.mustChangePassword){$('passwordCard').classList.remove('hidden');$('content').innerHTML='<h2>Password change required</h2><p>Please set a new password before continuing.</p>';}
  else $('passwordCard').classList.add('hidden');
}
$('loginBtn').onclick=async()=>{
  $('error').textContent='';
  try{
    const s=await api('/v1/auth/login',{method:'POST',body:JSON.stringify({workspaceId:$('workspace').value.trim(),username:$('username').value.trim(),password:$('password').value,rememberMe:$('remember').checked})});
    setSession(s);render();
  }catch(e){$('error').textContent='Login failed. Check your Company ID, username and password.';}
};
$('logout').onclick=async()=>{try{await api('/v1/auth/logout',{method:'POST'});}catch{} clearSession();render();};
$('changePasswordBtn').onclick=async()=>{
  $('passwordError').textContent='';
  try{
    const current=$('currentPassword').value,newPassword=$('newPassword').value;
    if(newPassword.length<10) throw Error('New password must be at least 10 characters.');
    const result=await api('/v1/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:current,newPassword})});
    session.user.mustChangePassword=false;setSession(session);$('currentPassword').value='';$('newPassword').value='';render();$('content').innerHTML='<h2>Password updated</h2><p>Your account is ready.</p>';
    void result;
  }catch(e){$('passwordError').textContent=e?.message||'Password change failed.';}
};
document.querySelectorAll('[data-module]').forEach((button)=>button.onclick=async()=>{
  const module=button.dataset.module;
  $('content').innerHTML='<p>Loading…</p>';
  if(module==='messages'){
    try{
      const rows=await api('/v1/messages');
      $('content').innerHTML=`<h2>Messages</h2>${rows.length?rows.map(x=>`<article class="message"><strong>${escapeHtml(x.subject)}</strong><small>${escapeHtml(x.sender_name)} → ${escapeHtml(x.recipient_name)}</small><p>${escapeHtml(x.body)}</p></article>`).join(''):'<p>No messages.</p>'}`;
      return;
    }catch{$('content').innerHTML='<p>Unable to load messages.</p>';return;}
  }
  try{
    const data=await api(`/v1/data/${encodeURIComponent(module)}?limit=100`);
    const rows=data.rows||[];
    $('content').innerHTML=`<h2>${module[0].toUpperCase()+module.slice(1)}</h2>${rows.length?`<div class="table-wrap"><table><thead><tr>${Object.keys(rows[0]).filter(k=>!k.startsWith('_')).slice(0,8).map(k=>`<th>${escapeHtml(k)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${Object.keys(rows[0]).filter(k=>!k.startsWith('_')).slice(0,8).map(k=>`<td>${escapeHtml(row[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p>No online records available.</p>'}`;
  }catch(e){$('content').innerHTML=`<h2>${module[0].toUpperCase()+module.slice(1)}</h2><p>${escapeHtml(e.message||'You do not have access to this module.')}</p>`;}
});
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
render();
