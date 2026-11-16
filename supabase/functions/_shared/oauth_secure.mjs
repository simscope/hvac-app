export class OAuthFailure extends Error {
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
const fail=(code,status)=>{throw new OAuthFailure(code,status);};
export const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('');
export const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const challenge=async verifier=>btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export async function encryptToken(value,key64){
 const raw=Uint8Array.from(atob(key64),x=>x.charCodeAt(0));if(raw.length!==32)fail('ENCRYPTION_CONFIG',503);
 const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));
 const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value)));
 return btoa(String.fromCharCode(...iv,...ct));
}
export function createOAuthHandlers({context,store,provider,config}){
 const cookieName='__Host-hvac_oauth';
 const headers=req=>({'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...(req.headers.get('origin')===config.origin?{'Access-Control-Allow-Origin':config.origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'authorization,apikey,content-type','Vary':'Origin'}:{})});
 const json=(req,data,status=200,extra={})=>Response.json(data,{status,headers:{...headers(req),...extra}});
 const cookie=req=>(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(cookieName+'=')).map(x=>x.slice(cookieName.length+1));
 const bound=async(req,state)=>{
  if(typeof state!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(state))fail('STATE_INVALID');
  const cookies=cookie(req);if(cookies.length!==1||!/^[A-Za-z0-9_-]{43}$/.test(cookies[0]))fail('BROWSER_SESSION_REQUIRED',401);
  return {state_sha:await sha(state),cookie_sha:await sha(cookies[0])};
 };
 const auth=async req=>{const ctx=await context(req);if(!ctx)fail('LIVE_STAFF_SESSION_REQUIRED',401);return ctx;};
 const secureConfig=()=>{const uri=new URL(config.redirect);if(uri.hostname.endsWith('.supabase.co'))fail('CLOUD_CALLBACK_FORBIDDEN',503);if(uri.protocol!=='https:'&&!(uri.protocol==='http:'&&uri.hostname==='127.0.0.1'))fail('CALLBACK_CONFIG_INVALID',503);};
 const safe=fn=>async req=>{try{return await fn(req);}catch(e){return json(req,{ok:false,error:e instanceof OAuthFailure?e.code:'OAUTH_OPERATION_FAILED'},e instanceof OAuthFailure?e.status:502);}};
 return {
  start:safe(async req=>{
   if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)});
   if(req.method!=='POST')fail('POST_REQUIRED',405);
   if(req.headers.get('origin')!==config.origin)fail('ORIGIN_REJECTED',403);
   secureConfig();const ctx=await auth(req);const body=await req.json().catch(()=>({}));
   if(body.user&&body.user!==ctx.user||body.org&&body.org!==ctx.org)fail('OWNER_MISMATCH',403);
   const cfg=await store('config',{mailbox:config.mailbox});if(!cfg||cfg.org!==ctx.org)fail('ORGANIZATION_REJECTED',403);
   const state=random(),nonce=random(),verifier=random();
   if(!await store('create',{...ctx,mailbox:config.mailbox,state_sha:await sha(state),cookie_sha:await sha(nonce),verifier,redirect_uri:config.redirect}))fail('STATE_CREATE_REJECTED',403);
   const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:config.redirect,response_type:'code',scope:'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',state,code_challenge:await challenge(verifier),code_challenge_method:'S256',access_type:'offline',prompt:'consent'}).toString();
   return json(req,{ok:true,authorization_url:url.href},200,{'Set-Cookie':`${cookieName}=${nonce}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`});
  }),
  callback:safe(async req=>{
   if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)});
   secureConfig();
   if(req.method==='GET'){
    const q=new URL(req.url).searchParams;const input=await bound(req,q.get('state'));const tx=await store('peek',input);if(!tx||tx.redirect_uri!==config.redirect)fail('STATE_EXPIRED_OR_REPLAYED');
    if(q.has('error'))fail('PROVIDER_AUTHORIZATION_DENIED');const code=q.get('code');if(!code||code.length>4096)fail('CODE_REQUIRED');
    const target=new URL('/oauth-gmail/complete',config.origin);target.hash=new URLSearchParams({code,state:q.get('state')}).toString();
    return new Response(null,{status:302,headers:{...headers(req),Location:target.href}});
   }
   if(req.method!=='POST')fail('POST_REQUIRED',405);
   if(req.headers.get('origin')!==config.origin)fail('ORIGIN_REJECTED',403);
   const ctx=await auth(req);const body=await req.json();const input=await bound(req,body.state);
   if(body.user&&body.user!==ctx.user||body.org&&body.org!==ctx.org)fail('OWNER_MISMATCH',403);
   if(typeof body.code!=='string'||!body.code||body.code.length>4096)fail('CODE_REQUIRED');
   const tx=await store('claim',{...input,...ctx});if(!tx||tx.redirect_uri!==config.redirect)fail('STATE_OWNER_EXPIRED_OR_REPLAYED',403);
   const token=await provider.exchange({code:body.code,verifier:tx.verifier,redirect:tx.redirect_uri});
   if(!token.access_token)fail('TOKEN_RESPONSE_INVALID',502);
   const profile=await provider.profile(token.access_token);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.emailAddress||''))fail('MAILBOX_IDENTITY_INVALID',502);
   const account=profile.emailAddress.trim().toLowerCase();const cfg=await store('config',{mailbox:tx.mailbox});if(!cfg||cfg.org!==ctx.org||cfg.mailbox_sha!==await sha(account))fail('MAILBOX_OR_ORGANIZATION_MISMATCH',403);
   const access_enc=await encryptToken(token.access_token,config.encryptionKey);const refresh_enc=token.refresh_token?await encryptToken(token.refresh_token,config.encryptionKey):null;
   const seconds=Number(token.expires_in);if(!Number.isFinite(seconds)||seconds<60||seconds>86400)fail('TOKEN_EXPIRY_INVALID',502);
   const ok=await store('finish',{...input,...ctx,email:account,mailbox_sha:await sha(account),access_enc,refresh_enc,expires_at:new Date(Date.now()+(seconds-30)*1000).toISOString()});if(!ok)fail('CREDENTIAL_COMMIT_REJECTED',403);
   return json(req,{ok:true,connected:true},200,{'Set-Cookie':`${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`});
  })
 };
}
