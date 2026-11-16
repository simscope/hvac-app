import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { createAuthEmailHandler } from '../_shared/auth_email_core.mjs';
import { createGmailAuthSender } from '../_shared/auth_email_gmail.mjs';

const secret = Deno.env.get('AUTH_SEND_EMAIL_HOOK_SECRET') || '';
if (!/^v1,whsec_[A-Za-z0-9+/=]{40,88}$/.test(secret)) throw new Error('HOOK_SIGNING_SECRET_REQUIRED');
const webhook = new Webhook(secret.replace('v1,whsec_', ''));
const base = Deno.env.get('SUPABASE_URL') || '';
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
async function rpc(name: string, digest: string) {
  const result = await fetch(base + '/rest/v1/rpc/' + name, {method: 'POST', headers: {apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json'}, body: JSON.stringify({p_digest: digest}), redirect: 'error', signal: AbortSignal.timeout(500)});
  if (!result.ok) throw new Error('PRIVATE_DELIVERY_STORE_REJECTED');
  return result.json();
}
Deno.serve(createAuthEmailHandler({
  verify: (raw: string, headers: Record<string, string>) => webhook.verify(raw, headers),
  claim: (digest: string) => rpc('hvac_auth_email_claim', digest),
  finish: (digest: string) => rpc('hvac_auth_email_finish', digest),
  send: createGmailAuthSender({getenv: (name: string) => Deno.env.get(name)}),
  config: {appOrigin: Deno.env.get('HVAC_OAUTH_APP_ORIGIN') || 'https://hvac-app-jade.vercel.app', publicApi: Deno.env.get('HVAC_PUBLIC_API_URL') || 'https://msi.tail4626fb.ts.net:8443'},
}));
