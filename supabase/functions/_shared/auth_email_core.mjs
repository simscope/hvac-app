// Auth hook protocol and templates. Provider and durable dedupe are injected.
class HookFailure extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new HookFailure(code, status); };
const email = value => {
  if (typeof value !== 'string' || value.length > 320 || !/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(value)) fail('INVALID_RECIPIENT');
  return value;
};
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(x => x.toString(16).padStart(2, '0')).join('');
const actions = {
  signup: ['Confirm your Sim Scope account', 'Confirm your email address and finish signing up.'],
  invite: ['Your Sim Scope invitation', 'Accept this invitation to create your Sim Scope account.'],
  magiclink: ['Your Sim Scope sign-in link', 'Use this one-time link to sign in.'],
  recovery: ['Reset your Sim Scope password', 'Use this one-time link to choose a new password. If you did not request this, ignore this email.'],
  email_change: ['Confirm your Sim Scope email change', 'Confirm the requested change of email address. If you did not request this, contact your administrator.'],
  email: ['Confirm your Sim Scope email address', 'Confirm your email address.'],
};
const notices = {
  password_changed_notification: 'Your Sim Scope password was changed.',
  email_changed_notification: 'Your Sim Scope email address was changed.',
  phone_changed_notification: 'Your Sim Scope phone number was changed.',
  identity_linked_notification: 'A sign-in identity was linked to your Sim Scope account.',
  identity_unlinked_notification: 'A sign-in identity was removed from your Sim Scope account.',
  mfa_factor_enrolled_notification: 'A multi-factor authentication method was added to your Sim Scope account.',
  mfa_factor_unenrolled_notification: 'A multi-factor authentication method was removed from your Sim Scope account.',
};

export async function messagesFor(event, config) {
  const user = event?.user, data = event?.email_data;
  if (!user || !data || typeof user.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(user.id)) fail('INVALID_EVENT');
  const kind = data.email_action_type;
  const app = new URL(config.appOrigin), api = new URL(config.publicApi);
  if (app.protocol !== 'https:' || api.protocol !== 'https:') fail('INVALID_SERVER_CONFIGURATION', 503);
  if (data.site_url && new URL(data.site_url).origin !== app.origin) fail('INVALID_SITE_URL');
  const redirect = new URL(data.redirect_to || app.href);
  if (redirect.origin !== app.origin || redirect.username || redirect.password) fail('INVALID_REDIRECT');
  if (kind === 'recovery' && redirect.pathname === '/' && !redirect.search && !redirect.hash) redirect.pathname = '/reset-password';
  const make = async (recipient, tokenHash, token, suffix = '') => {
    const to = email(recipient);
    if (typeof tokenHash !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(tokenHash)) fail('INVALID_TOKEN_HASH');
    const link = new URL('/auth/v1/verify', api);
    link.search = new URLSearchParams({token: tokenHash, type: kind, redirect_to: redirect.href}).toString();
    const template = actions[kind];
    return {to, subject: template[0], text: template[1] + '\n\n' + link.href + '\n\nThis link expires and can be used only once.', key: await hash([user.id, kind, to.toLowerCase(), tokenHash, suffix].join('\n'))};
  };
  if (kind === 'reauthentication') {
    const to = email(user.email);
    if (!/^\d{6,10}$/.test(String(data.token))) fail('INVALID_VERIFICATION_CODE');
    return [{to, subject: 'Your Sim Scope verification code', text: `Your verification code is ${data.token}. It expires shortly. If you did not request this, ignore this email.`, key: await hash([user.id, kind, to.toLowerCase(), data.token].join('\n'))}];
  }
  if (notices[kind]) {
    const to = email(user.email);
    return [{to, subject: 'Sim Scope account security notification', text: notices[kind] + ' If this was not you, contact your administrator immediately.', key: await hash([user.id, kind, to.toLowerCase(), event.webhook_id].join('\n'))}];
  }
  if (!actions[kind]) fail('UNSUPPORTED_EMAIL_ACTION');
  if (kind === 'email_change') {
    // GoTrue's historical field names are reversed for the current address.
    // token_hash_new -> current email; token_hash -> new email.
    if (data.token_hash_new) {
      return [await make(user.email, data.token_hash_new, data.token, 'current'), await make(user.new_email, data.token_hash, data.token_new, 'new')];
    }
    return [await make(user.new_email, data.token_hash, data.token_new || data.token, 'new')];
  }
  return [await make(user.email, data.token_hash, data.token)];
}

export function createAuthEmailHandler({verify, claim, finish, send, config}) {
  return async request => {
    const response = (status, code) => Response.json(code ? {error: {http_code: status, message: code}} : {}, {status, headers: {'Cache-Control': 'no-store'}});
    if (request.method !== 'POST') return response(405, 'POST_REQUIRED');
    const length = request.headers.get('content-length');
    if (length && Number(length) > 65536) return response(413, 'PAYLOAD_TOO_LARGE');
    try {
      const deadlineAt = Date.now() + 4000;
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 65536) return response(413, 'PAYLOAD_TOO_LARGE');
      let event;
      try { event = verify(raw, Object.fromEntries(request.headers)); } catch { return response(401, 'INVALID_HOOK_SIGNATURE'); }
      event.webhook_id = request.headers.get('webhook-id');
      const messages = await messagesFor(event, config);
      for (const message of messages) {
        const state = await claim(message.key);
        if (state === 'ALREADY_SENT') continue;
        if (state !== 'CLAIMED_NOW') return response(409, 'DELIVERY_ALREADY_IN_PROGRESS');
        // A provider/network failure remains claimed. Do not automatically replay
        // an ambiguous external send; operator evidence is required to retry it.
        await send(message, {deadlineAt});
        if (!await finish(message.key)) return response(503, 'DELIVERY_RECEIPT_NOT_COMMITTED');
      }
      return response(200);
    } catch (error) {
      return response(error instanceof HookFailure ? error.status : 502, error instanceof HookFailure ? error.code : 'AUTH_EMAIL_DELIVERY_FAILED');
    }
  };
}
