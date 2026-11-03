import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY, SITE_URL, TURNSTILE_SITE_KEY, PUSH_PUBLIC_KEY } from './config.js';
import './app.js';

const $ = id => document.getElementById(id);
const app = window.Bolso;
// Migra uma vez a sessão da versão anterior; nunca restaura uma sessão após Sair.
const authKey = 'meu-bolso-auth';
if (!localStorage.getItem(authKey + '-migrated')) {
  for (const key of [authKey, authKey + '-code-verifier']) {
    const previous = sessionStorage.getItem(key);
    if (previous && !localStorage.getItem(key)) localStorage.setItem(key, previous);
  }
  localStorage.setItem(authKey + '-migrated', '1');
}
for (const key of [authKey, authKey + '-code-verifier']) sessionStorage.removeItem(key);
const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage: localStorage, storageKey: authKey, flowType: 'pkce',
    persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
let captchaWidget = null;
async function captchaToken() {
  if (!TURNSTILE_SITE_KEY) return undefined;
  const token = window.turnstile?.getResponse(captchaWidget);
  if (!token) throw Error('Confirme a verificação de segurança e tente novamente.');
  return token;
}
function resetCaptcha() { if(captchaWidget !== null) window.turnstile?.reset(captchaWidget); }
if (TURNSTILE_SITE_KEY) {
  const script=document.createElement('script');
  script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.onload=()=>{ captchaWidget=window.turnstile.render('#captcha-widget',{sitekey:TURNSTILE_SITE_KEY}); };
  script.onerror=()=>message('Não foi possível carregar a verificação de segurança. Recarregue a página.');
  document.head.append(script);
}
let userId = null, revision = 0, pending = null, busy = false, authBusy = false;
let factorId = null, recovery = false, generation = 0;
const editable = () => !!userId && !pending && !busy && navigator.onLine;
const draftKey = id => 'meu-bolso-draft:' + id;
const message = text => { $('auth-message').textContent = text; };
const status = text => {
  if(text==='Sincronizado') queueMicrotask(()=>void checkReminders());
  $('sync-status').textContent = text;
  const warning = !!userId && text !== 'Sincronizado' && text !== 'Salvando na nuvem…';
  $('sync-alert').hidden = !warning;
  $('sync-alert-text').textContent = warning ? text : '';
};
function freeze() {
  // Conta e recuperação de conflitos continuam acessíveis durante falhas de gravação.
  for (const el of document.querySelectorAll('.page:not(#settings),.month-box,.fab,.modal-overlay,.settings-data')) el.inert = !editable();
  $('legacy-import').disabled = !editable();
}
function lock(text) {
  generation++; userId = null; pending = null; revision = 0; busy = false;
  app.clear(); document.body.classList.add('locked'); $('auth-screen').hidden = false;
  $('sync-alert').hidden = true;
  $('account-email').textContent = ''; $('profile-name').value = '';
  $('profile-password').value = ''; $('profile-password-confirm').value = '';
  $('profile-message').textContent = ''; $('profile-password-message').textContent = '';
  for (const id of ['login-form','mfa-panel','password-form','retry-access','auth-logout']) $(id).hidden = true;
  $('mfa-setup').hidden = true; $('mfa-secret').textContent = ''; $('mfa-qr').removeAttribute('src');
  $('mfa-code').value = ''; factorId = null; freeze(); message(text);
}
function readableError(error) {
  if (error?.code === 'PT429' || error?.status === 429) return 'Muitas solicitações. Aguarde um minuto antes de sincronizar novamente.';
  if (error?.code === '40001') return 'Outro aparelho salvou uma alteração. Baixe seu backup pendente antes de carregar a versão da nuvem.';
  if (['PGRST202','PGRST205','42P01'].includes(error?.code)) return 'O banco ainda precisa ser configurado. Execute o arquivo 01-banco.sql no painel do Supabase.';
  if (error?.code === '42501') return 'Acesso bloqueado. Confira a conta autorizada e a verificação em duas etapas.';
  return 'Não foi possível conectar ou salvar. Verifique a internet e tente novamente. Suas alterações pendentes continuam nesta aba.';
}
async function readCloud(id) {
  const { data, error } = await client.rpc('bolso_read').maybeSingle();
  if (error) throw error;
  return data ? { document: app.validate(data.document), revision: Number(data.revision) } : { document: app.initial(), revision: 0 };
}
async function openAccount(session) {
  const epoch = generation;
  const { data: allowed, error } = await client.rpc('bolso_access');
  if (error) throw error;
  if (!allowed) throw { code: '42501' };
  const remote = await readCloud(session.user.id);
  if (epoch !== generation) return;
  userId = session.user.id; revision = remote.revision; app.set(remote.document);
  // Um rascunho nunca é aplicado à conta de outra pessoa.
  const raw = sessionStorage.getItem(draftKey(userId));
  if (raw) {
    const draft = JSON.parse(raw);
    pending = { document: app.validate(draft.document), revision: draft.revision };
    app.set(pending.document);
  }
  $('account-email').textContent = session.user.email || 'Minha conta';
  $('profile-name').value = session.user.user_metadata?.display_name || '';
  void restoreReminders(userId, epoch);
  document.body.classList.remove('locked'); $('auth-screen').hidden = true;
  $('mfa-secret').textContent = ''; $('mfa-qr').removeAttribute('src'); $('mfa-setup').hidden = true;
  $('login-password').value = ''; $('mfa-code').value = '';
  $('legacy-panel').hidden = !Object.values(app.legacy().months).some(items => items.length);
  $('legacy-import').hidden = Object.values(remote.document.months).some(items => items.length);
  $('cloud-reload').hidden = !pending;
  status(pending ? 'Há uma alteração pendente nesta aba. Clique em Sincronizar.' : 'Sincronizado');
  freeze();
}
async function continueLogin() {
  if (authBusy) return;
  authBusy = true;
  try {
    lock('Verificando sua conta…');
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const session = data.session;
    if (!session) { $('login-form').hidden = false; message('Entre com sua conta autorizada.'); return; }
    $('auth-logout').hidden = false;
    const { data: assurance, error: aalError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError) throw aalError;
    if (assurance.currentLevel !== 'aal2') {
      const { data: factors, error: factorsError } = await client.auth.mfa.listFactors();
      if (factorsError) throw factorsError;
      factorId = factors.totp.find(f => f.status === 'verified')?.id || null;
      $('mfa-panel').hidden = false; $('mfa-form').hidden = !factorId; $('enroll-mfa').hidden = !!factorId;
      $('mfa-instructions').textContent = factorId ? 'Abra seu autenticador e digite o código atual.' : 'Cadastre o Meu Bolso no seu aplicativo autenticador. A conta exige essa proteção para acessar as despesas.';
      message('Confirme que é você.'); return;
    }
    if (recovery) { $('password-form').hidden = false; message('Defina sua nova senha.'); return; }
    await openAccount(session);
  } catch (error) { message(readableError(error)); $('retry-access').hidden = false; }
  finally { authBusy = false; }
}
async function savePending() {
  if (!userId || busy || !pending) return;
  const epoch = generation, id = userId, draft = pending;
  busy = true; freeze(); status('Salvando na nuvem…');
  try {
    const { data, error } = await client.rpc('bolso_save', { p_document: draft.document, p_revision: draft.revision });
    if (epoch !== generation) return;
    if (error) throw error;
    revision = Number(data); pending = null; sessionStorage.removeItem(draftKey(id));
    $('cloud-reload').hidden = true; status('Sincronizado');
    $('legacy-import').hidden = Object.values(app.get().months).some(items => items.length);
  } catch (error) {
    if (epoch !== generation) return;
    status(readableError(error)); $('cloud-reload').hidden = false;
  } finally { if (epoch === generation) { busy = false; freeze(); } }
}
app.commit = document => {
  if (!userId || pending || busy) throw Error('Aguarde a sincronização antes de alterar novamente.');
  pending = { document: app.validate(document), revision };
  try { sessionStorage.setItem(draftKey(userId), JSON.stringify(pending)); }
  catch { status('Não foi possível guardar o rascunho nesta aba. Baixe um backup antes de fechar.'); }
  freeze(); void savePending();
};
async function refresh() {
  if (!userId || busy) return;
  if (pending) { await savePending(); return; }
  if (document.querySelector('.modal-overlay.open') || document.activeElement?.matches('input,textarea,select')) return;
  const epoch = generation;
  busy = true; freeze();
  try {
    const { data: access, error: accessError } = await client.rpc('bolso_access');
    if (accessError) throw accessError;
    if (!access) { await continueLogin(); return; }
    const remote = await readCloud(userId);
    if (epoch !== generation) return;
    if (remote.revision !== revision) { revision = remote.revision; app.set(remote.document); }
    status('Sincronizado');
  } catch (error) { if (epoch === generation) {
    if (error?.code === '42501') { lock('Sessão encerrada ou acesso revogado. Entre novamente.'); $('login-form').hidden=false; }
    else status(readableError(error));
  } }
  finally { if (epoch === generation) { busy = false; freeze(); } }
}
async function signOut(scope = 'local') {
  if (typeof scope !== 'string') scope = 'local';
  if (pending && !confirm('Há uma alteração ainda não salva na nuvem. Baixe um backup antes de sair. Sair mesmo assim?')) return;
  const oldId = userId;
  lock('Encerrando sessão…'); recovery = false;
  const { error } = await client.auth.signOut({ scope });
  if (error) { message('Não foi possível encerrar a sessão. Tente novamente.'); $('auth-logout').hidden = false; return; }
  if (oldId) sessionStorage.removeItem(draftKey(oldId));
  $('login-form').hidden = false; message('Sessão encerrada neste aparelho.');
}
$('login-form').addEventListener('submit', async e => {
  e.preventDefault(); const button = e.submitter; button.disabled = true; message('Entrando…');
  try {
    const { error } = await client.auth.signInWithPassword({ email: $('login-email').value.trim(), password: $('login-password').value, options: { captchaToken: await captchaToken() } });
    $('login-password').value = '';
    if (error) { message('Não foi possível entrar. Confira e-mail e senha ou aguarde antes de tentar novamente.'); return; }
    await continueLogin();
  } catch { message('Falha de conexão. Tente novamente.'); }
  finally { resetCaptcha(); button.disabled = false; }
});
$('enroll-mfa').addEventListener('click', async () => {
  $('enroll-mfa').disabled = true;
  try {
    const { data: factors, error: listError } = await client.auth.mfa.listFactors();
    if (listError) throw listError;
    // Limpa somente cadastros incompletos gerados por esta tela.
    for (const f of factors.all.filter(f => f.status === 'unverified' && f.friendly_name === 'Meu Bolso')) {
      const { error } = await client.auth.mfa.unenroll({ factorId: f.id }); if (error) throw error;
    }
    const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Meu Bolso', issuer: 'Meu Bolso' });
    if (error) throw error;
    factorId = data.id;
    const svg = data.totp.qr_code.replace(/^data:image\/svg\+xml;[^,]*,/, '');
    $('mfa-qr').src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    $('mfa-secret').textContent = data.totp.secret; $('mfa-setup').hidden = false;
    $('mfa-form').hidden = false; $('enroll-mfa').hidden = true;
    message('Escaneie o QR Code e confirme com um código do autenticador.');
  } catch { message('Não foi possível cadastrar o autenticador. Tente novamente.'); }
  finally { $('enroll-mfa').disabled = false; }
});
$('mfa-form').addEventListener('submit', async e => {
  e.preventDefault(); const button=e.submitter; button.disabled=true;
  try {
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code: $('mfa-code').value.trim() });
    $('mfa-code').value = '';
    if (error) { message('Código inválido ou expirado. Confira o horário do celular e tente o código atual.'); return; }
    await continueLogin();
  } catch { message('Falha ao verificar. Tente novamente.'); }
  finally { button.disabled=false; }
});
$('forgot-password').addEventListener('click', async () => {
  if (!$('login-email').reportValidity()) return;
  $('forgot-password').disabled = true;
  try {
    const { error } = await client.auth.resetPasswordForEmail($('login-email').value.trim(), { redirectTo: SITE_URL, captchaToken: await captchaToken() });
    if (error) throw error;
    message('Se o endereço estiver cadastrado e o envio de e-mail estiver configurado, você receberá um link. Abra-o neste mesmo navegador.');
  } catch { message('Falha de conexão. Tente novamente.'); }
  finally { resetCaptcha(); $('forgot-password').disabled = false; }
});
$('password-form').addEventListener('submit', async e => {
  e.preventDefault(); const button=e.submitter; button.disabled=true;
  try {
    const { error } = await client.auth.updateUser({ password: $('new-password').value });
    if (error) { message('Não foi possível alterar a senha. Verifique os requisitos ou solicite um novo link.'); return; }
    $('new-password').value = ''; recovery = false; await continueLogin();
  } catch { message('Falha de conexão ao alterar a senha. Tente novamente.'); }
  finally { button.disabled=false; }
});
$('logout-all').addEventListener('click', () => { if(confirm('Encerrar o acesso em todos os aparelhos?')) void signOut('global'); });
function checkReminders() { if(userId && !document.hidden)app.renderDue(); }
let reminderAction=false;
function reminderControls(busy){reminderAction=busy;for(const id of ['enable-reminders','disable-reminders'])$(id).disabled=busy;}
async function restoreReminders(id,epoch) {
 const current=()=>id===userId && epoch===generation;
 $('reminder-status').textContent='Avisos do sistema desativados. A lista no início continua disponível.';
 if(!PUSH_PUBLIC_KEY || localStorage.getItem('meu-bolso-reminders:'+id)!=='push' || reminderAction)return;
 reminderControls(true);
 try {
  if(!('Notification' in window) || Notification.permission!=='granted')throw Error('permission');
  const registration=await navigator.serviceWorker.getRegistration();
  const subscription=await registration?.pushManager.getSubscription();
  if(!subscription)throw Error('subscription');
  if(!current())return;
  const {error}=await client.rpc('bolso_push_subscribe',{p_subscription:subscription.toJSON()});
  if(error)throw error;
  if(current())$('reminder-status').textContent='Aparelho cadastrado para o resumo diário às 9h de Brasília.';
 }catch{if(current())$('reminder-status').textContent='Reative os avisos neste aparelho para confirmar o cadastro.';}
 finally{reminderControls(false);}
}
$('enable-reminders').addEventListener('click',async()=>{
 if(!userId || reminderAction)return;
 if(!PUSH_PUBLIC_KEY){$('reminder-status').textContent='O envio diário ainda precisa ser ativado no servidor.';return;}
 if(!('Notification' in window) || !('PushManager' in window)){
  $('reminder-status').textContent='No iPhone, abra o Meu Bolso pelo ícone da Tela de Início para ativar notificações.';return;
 }
 const id=userId,epoch=generation;reminderControls(true);
 try {
  if(await Notification.requestPermission()!=='granted'){ $('reminder-status').textContent='Permissão não concedida.';return; }
  const registration=await navigator.serviceWorker.getRegistration();
  if(!registration?.active)throw Error('Service worker indisponível');
  const raw=atob(PUSH_PUBLIC_KEY.replace(/-/g,'+').replace(/_/g,'/'));
  const subscription=await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(raw,c=>c.charCodeAt(0))});
  if(userId!==id || generation!==epoch)return;
  const {error}=await client.rpc('bolso_push_subscribe',{p_subscription:subscription.toJSON()});
  if(error)throw error;
  if(userId!==id || generation!==epoch)return;
  localStorage.setItem('meu-bolso-reminders:'+id,'push');
  $('reminder-status').textContent='Resumo diário ativado para este aparelho, às 9h de Brasília, mesmo com o app fechado.';
 }catch{if(userId===id && generation===epoch)$('reminder-status').textContent='Não foi possível ativar. Confira a conexão e a configuração do servidor.';}
 finally{reminderControls(false);}
});
$('disable-reminders').addEventListener('click',async()=>{
 if(!userId || reminderAction)return;
 const id=userId,epoch=generation;reminderControls(true);
 try {
  const registration=await navigator.serviceWorker.getRegistration();const subscription=await registration?.pushManager.getSubscription();
  if(userId!==id || generation!==epoch)return;
  if(subscription){const {error}=await client.rpc('bolso_push_unsubscribe',{p_endpoint:subscription.endpoint});if(error)throw error;await subscription.unsubscribe();}
  localStorage.removeItem('meu-bolso-reminders:'+id);
  if(userId===id && generation===epoch)$('reminder-status').textContent='Avisos desativados neste aparelho.';
 }catch{if(userId===id && generation===epoch)$('reminder-status').textContent='Não foi possível desativar no servidor. Tente novamente ou bloqueie notificações nos ajustes do aparelho.';}
 finally{reminderControls(false);}
});
setInterval(checkReminders,60000);
document.addEventListener('visibilitychange',checkReminders);
$('retry-access').addEventListener('click', continueLogin);
$('sync-alert-open').addEventListener('click', () => document.querySelector('[data-page="settings"]').click());
$('profile-form').addEventListener('submit', async e => {
  e.preventDefault(); if (!userId) return;
  const epoch = generation, button = e.submitter; button.disabled = true;
  $('profile-message').textContent = 'Salvando perfil…';
  try {
    const { error } = await client.auth.updateUser({ data: { display_name: $('profile-name').value.trim() } });
    if (epoch !== generation) return;
    $('profile-message').textContent = error ? 'Não foi possível salvar o perfil. Tente novamente.' : 'Perfil atualizado.';
  } catch { if (epoch === generation) $('profile-message').textContent = 'Confira a conexão e tente novamente.'; }
  finally { button.disabled = false; }
});
$('profile-password-form').addEventListener('submit', async e => {
  e.preventDefault(); if (!userId) return;
  const password = $('profile-password'), confirmation = $('profile-password-confirm');
  if (password.value !== confirmation.value) { $('profile-password-message').textContent = 'Digite a mesma senha nos dois campos.'; return; }
  const epoch = generation, button = e.submitter; button.disabled = true;
  $('profile-password-message').textContent = 'Alterando senha…';
  try {
    const { error } = await client.auth.updateUser({ password: password.value });
    if (epoch !== generation) return;
    $('profile-password-message').textContent = error ? 'Não foi possível alterar. Confira os requisitos da senha; se necessário, saia e entre novamente para tentar.' : 'Senha alterada.';
  } catch { if (epoch === generation) $('profile-password-message').textContent = 'Confira a conexão e tente novamente.'; }
  finally { password.value = ''; confirmation.value = ''; button.disabled = false; }
});
$('auth-logout').addEventListener('click', signOut); $('cloud-logout').addEventListener('click', signOut);
$('sync-retry').addEventListener('click', refresh); $('cloud-backup').addEventListener('click', app.backup);
$('legacy-backup').addEventListener('click', app.legacyBackup);
$('legacy-import').addEventListener('click', () => {
  if (!editable() || Object.values(app.get().months).some(items=>items.length)) return;
  if (!confirm('Enviar o histórico antigo deste navegador ao banco Supabase da conta '+$('account-email').textContent+'? Baixe uma cópia antes de continuar.')) return;
  const data = app.legacy(); app.set(data); app.commit(data);
});
$('cloud-reload').addEventListener('click', async () => {
  if (!userId || busy || !confirm('Descartar a alteração pendente desta aba e carregar a versão da nuvem? Baixe seu backup antes.')) return;
  sessionStorage.removeItem(draftKey(userId)); pending=null; await continueLogin();
});
window.addEventListener('beforeunload', e => { if (pending) { e.preventDefault(); e.returnValue=''; } });
window.addEventListener('online', () => { freeze(); void refresh(); });
window.addEventListener('offline', () => { freeze(); status('Sem internet. Alterações bloqueadas até reconectar.'); });
window.addEventListener('focus', () => void refresh());
window.addEventListener('storage', e => {
  if ((e.key === authKey && !e.newValue) || e.key === null) {
    lock('Sua sessão terminou neste navegador. Entre novamente.'); $('login-form').hidden = false;
  }
});
setInterval(() => { if (!document.hidden) void refresh(); }, 30000);
client.auth.onAuthStateChange((event, session) => {
  // Não aguardar chamadas de Auth dentro deste callback (lock interno do SDK).
  if (event === 'PASSWORD_RECOVERY') { recovery=true; setTimeout(continueLogin, 0); }
  if (event === 'SIGNED_OUT') { lock('Sua sessão terminou. Entre novamente.'); $('login-form').hidden=false; }
  if (userId && session && session.user.id !== userId) { lock('A conta mudou. Entre novamente.'); setTimeout(continueLogin,0); }
});
await continueLogin();
document.body.classList.remove('launching');
window.dispatchEvent(new Event('bolso-ready'));
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
