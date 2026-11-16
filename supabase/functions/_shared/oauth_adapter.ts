import { createOAuthHandlers, OAuthFailure } from './oauth_secure.mjs';
const base=Deno.env.get('SUPABASE_URL')||'';
if(!['api-gw','kong','hvac-validation-api-gw','127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('LOCAL_BACKEND_REQUIRED');
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const origin=Deno.env.get('HVAC_OAUTH_APP_ORIGIN')||'https://hvac-app-jade.vercel.app';
async function rpc(name:string,body:unknown,authorization:string){
 const r=await fetch(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:service,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!r.ok)throw new OAuthFailure('LOCAL_STORE_REJECTED',r.status===401||r.status===403?403:503);
 return await r.json();
}
const context=async(req:Request)=>{
 const header=req.headers.get('authorization');if(!header?.startsWith('Bearer '))return null;
 const r=await fetch(`${base}/auth/v1/user`,{headers:{apikey:Deno.env.get('SUPABASE_ANON_KEY')||'',Authorization:header},signal:AbortSignal.timeout(10000),redirect:'error'});if(!r.ok)return null;
 const user=await r.json();const ctx=await rpc('hvac_oauth_context',{},header);
 return ctx?.user===user.id?ctx:null;
};
async function google(url:string,init:RequestInit){
 const r=await fetch(url,{...init,signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!r.ok)throw new OAuthFailure('GOOGLE_EXCHANGE_OR_PROFILE_REJECTED',502);
 return await r.json();
}
export const handlers=createOAuthHandlers({context,
 store:(action:string,args:unknown)=>rpc('hvac_oauth_store',{action,args},`Bearer ${service}`),
 provider:{
  exchange:({code,verifier,redirect}:any)=>google('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:redirect,client_id:Deno.env.get('GOOGLE_CLIENT_ID')||'',client_secret:Deno.env.get('GOOGLE_CLIENT_SECRET')||''})}),
  profile:(token:string)=>google('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:`Bearer ${token}`}})
 },
 config:{origin,redirect:Deno.env.get('HVAC_OAUTH_REDIRECT_URI')||'https://hvac-app-jade.vercel.app/functions/v1/oauth_google_callback',mailbox:'hvac-gmail',clientId:Deno.env.get('GOOGLE_CLIENT_ID')||'',encryptionKey:Deno.env.get('MAIL_ENC_KEY_B64')||''}
});
