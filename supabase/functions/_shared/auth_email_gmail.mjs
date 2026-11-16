// Dedicated Auth delivery through the existing Hvac Gmail OAuth mailbox.
export function createGmailAuthSender({getenv, fetcher = fetch}) {
  const base = getenv('SUPABASE_URL'), service = getenv('SUPABASE_SERVICE_ROLE_KEY');
  if (!['api-gw', 'kong', 'hvac-validation-api-gw', '127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('LOCAL_BACKEND_REQUIRED');
  const headers = {apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json'};
  const aesKey = async () => {
    const raw = Uint8Array.from(atob(getenv('MAIL_ENC_KEY_B64') || ''), x => x.charCodeAt(0));
    if (raw.length !== 32) throw new Error('MAIL_ENCRYPTION_KEY_REQUIRED');
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  };
  const decrypt = async value => {
    if (typeof value !== 'string') throw new Error('MAIL_CREDENTIAL_REQUIRED');
    if (value.startsWith('plain:')) return value.slice(6);
    const bytes = Uint8Array.from(atob(value), x => x.charCodeAt(0));
    return new TextDecoder().decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv: bytes.slice(0, 12)}, await aesKey(), bytes.slice(12)));
  };
  const encrypt = async value => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv}, await aesKey(), new TextEncoder().encode(value)));
    return btoa(String.fromCharCode(...iv, ...data));
  };
  const sha = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(x => x.toString(16).padStart(2, '0')).join('');
  return async (message, {deadlineAt = Date.now() + 4000} = {}) => {
    // Auth HTTP hooks have a five-second total budget. Reserve time for the
    // local durable receipt and never continue an eight-second provider request.
    const providerDeadline = Math.min(deadlineAt, Date.now() + 4000) - 500;
    const request = async (url, options = {}) => {
      const remaining = providerDeadline - Date.now();
      if (remaining < 100) throw new Error('AUTH_EMAIL_DEADLINE_EXPIRED');
      const result = await fetcher(url, {...options, redirect: 'error', signal: AbortSignal.timeout(remaining)});
      if (!result.ok) throw new Error('PROVIDER_REQUEST_REJECTED');
      return result;
    };
    const rows = await (await request(base + '/rest/v1/mail_accounts?provider=eq.gmail&select=id,email,access_token_enc,refresh_token_enc,token_expires_at&limit=2', {headers})).json();
    if (rows.length !== 1) throw new Error('EXACT_MAILBOX_REQUIRED');
    const account = rows[0];
    let access = await decrypt(account.access_token_enc);
    if (!access || !Number.isFinite(Date.parse(account.token_expires_at)) || Date.parse(account.token_expires_at) < Date.now() + 30000) {
      const tokens = await (await request('https://oauth2.googleapis.com/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({client_id: getenv('GOOGLE_CLIENT_ID'), client_secret: getenv('GOOGLE_CLIENT_SECRET'), refresh_token: await decrypt(account.refresh_token_enc), grant_type: 'refresh_token'})})).json();
      if (typeof tokens.access_token !== 'string' || !tokens.access_token || !Number.isFinite(Number(tokens.expires_in))) throw new Error('INVALID_TOKEN_RESPONSE');
      access = tokens.access_token;
      await request(base + '/rest/v1/mail_accounts?id=eq.' + encodeURIComponent(account.id), {method: 'PATCH', headers, body: JSON.stringify({access_token_enc: await encrypt(access), token_expires_at: new Date(Date.now() + (Number(tokens.expires_in) - 30) * 1000).toISOString(), updated_at: new Date().toISOString()})});
    }
    const profile = await (await request('https://gmail.googleapis.com/gmail/v1/users/me/profile', {headers: {Authorization: `Bearer ${access}`}})).json();
    if (!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(profile.emailAddress || '')) throw new Error('INVALID_AUTHENTICATED_SENDER');
    const config = await (await request(base + '/rest/v1/rpc/hvac_oauth_store', {method: 'POST', headers, body: JSON.stringify({action: 'config', args: {mailbox: 'hvac-gmail'}})})).json();
    if (!config || config.mailbox_sha !== await sha(profile.emailAddress.trim().toLowerCase())) throw new Error('CONFIGURED_MAILBOX_MISMATCH');
    const subject = btoa(String.fromCharCode(...new TextEncoder().encode(message.subject)));
    const mime = `From: ${profile.emailAddress}\r\nTo: ${message.to}\r\nSubject: =?UTF-8?B?${subject}?=\r\nMessage-ID: <${message.key}@hvac.simscope.local>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n` + btoa(String.fromCharCode(...new TextEncoder().encode(message.text))).match(/.{1,76}/g).join('\r\n') + '\r\n';
    const raw = btoa(String.fromCharCode(...new TextEncoder().encode(mime))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const receipt = await (await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {method: 'POST', headers: {Authorization: `Bearer ${access}`, 'Content-Type': 'application/json'}, body: JSON.stringify({raw})})).json();
    if (typeof receipt.id !== 'string' || !receipt.id) throw new Error('PROVIDER_RECEIPT_REQUIRED');
  };
}
