// Production contracts for recovered invoice, chat push and job badge handlers.
// Credentials and provider payloads are never logged.
export class ContractFailure extends Error {
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
const fail=(code,status)=>{throw new ContractFailure(code,status);};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const requiredUuid=value=>{if(!uuid(value))fail('UUID_REQUIRED');return value;};

export function createRecoveredHandlers({getenv,fetcher=fetch}){
  const base=getenv('SUPABASE_URL'),service=getenv('SUPABASE_SERVICE_ROLE_KEY'),anon=getenv('SUPABASE_ANON_KEY');
  const origin=getenv('HVAC_OAUTH_APP_ORIGIN')||'https://hvac-app-jade.vercel.app';
  if(!['api-gw','kong','hvac-validation-api-gw','127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('LOCAL_BACKEND_REQUIRED');
  if(getenv('HVAC_LOCAL_PUSH_SINK'))throw new Error('PRODUCTION_PUSH_SINK_FORBIDDEN');
  const cors=req=>req.headers.get('origin')===origin?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'}:{};
  const response=(req,status,body)=>Response.json(body,{status,headers:{...cors(req),'Cache-Control':'no-store'}});
  async function raw(path,options={},token=service){
    const res=await fetcher(base+path,{...options,headers:{apikey:token===service?service:anon,Authorization:'Bearer '+token,'Content-Type':'application/json',...(options.headers||{})},redirect:'error',signal:AbortSignal.timeout(12000)});
    return res;
  }
  async function rest(path,options={},ctx=null){
    const res=await raw('/rest/v1/'+path,options,ctx&&!ctx.service?ctx.token:service);
    if(!res.ok)fail(res.status===403||res.status===401?'ROW_ACCESS_REJECTED':'LOCAL_DATABASE_REQUEST_FAILED',res.status===403||res.status===401?403:502);
    return res.status===204?null:await res.json();
  }
  async function caller(req,{roles=[],serviceOnly=false}={}){
    const header=req.headers.get('authorization')||'';
    if(!header.startsWith('Bearer '))fail('AUTHORIZATION_REQUIRED',401);
    const token=header.slice(7);
    if(token===service)return {service:true,token};
    if(serviceOnly)fail('VERIFIED_SERVICE_CALLER_REQUIRED',403);
    const userRes=await raw('/auth/v1/user',{},token);
    if(!userRes.ok)fail('LIVE_SESSION_REQUIRED',401);
    const user=await userRes.json();
    const contextRes=await raw('/rest/v1/rpc/hvac_live_caller_context',{method:'POST',body:'{}'},token);
    const context=contextRes.ok?await contextRes.json():null;
    if(!context||context.user!==user.id||!roles.includes(context.role))fail('LIVE_PROJECT_ROLE_REQUIRED',403);
    return {...context,token,service:false};
  }
  const serve=action=>async req=>{
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(req)});
    if(req.method!=='POST')return response(req,405,{ok:false,error:'POST_REQUIRED'});
    try{return response(req,200,await action(req));}
    catch(error){return response(req,error instanceof ContractFailure?error.status:502,{ok:false,error:error instanceof ContractFailure?error.code:'OPERATION_FAILED'});}
  };
  async function technicianScope(ctx,id){
    requiredUuid(id);
    const rows=await rest('technicians?select=id,org_id,auth_user_id&id=eq.'+encodeURIComponent(id)+'&limit=2');
    if(rows.length!==1||!ctx.service&&rows[0].org_id!==ctx.org)fail('TECHNICIAN_ORGANIZATION_REQUIRED',403);
    return rows[0];
  }
  async function jobScope(ctx,id){
    requiredUuid(id);
    const rows=await rest('jobs?select=id,technician_id&id=eq.'+encodeURIComponent(id)+'&limit=2',{},ctx);
    if(rows.length!==1)fail('JOB_NOT_ACCESSIBLE',404);
    if(rows[0].technician_id)await technicianScope(ctx,rows[0].technician_id);
    return rows[0];
  }
  async function invoiceTarget(ctx,body){
    if((body.bucket||'invoices')!=='invoices')fail('INVOICE_BUCKET_REQUIRED');
    let job=body.job_id||null,number=body.invoice_no==null?null:Number(body.invoice_no),record=null;
    if(body.db_id){
      requiredUuid(body.db_id);
      const rows=await rest('invoices?select=id,job_id,invoice_no&id=eq.'+encodeURIComponent(body.db_id)+'&limit=2',{},ctx);
      if(rows.length!==1)fail('INVOICE_NOT_ACCESSIBLE',404);
      record=rows[0];
      if(job&&job!==record.job_id||number!=null&&number!==record.invoice_no)fail('INVOICE_TARGET_MISMATCH');
      job=record.job_id;number=record.invoice_no;
    }
    const key=String(body.key||'');
    if(key){
      const parts=key.split('/');
      if(parts.length<2||!uuid(parts[0])||parts.some(part=>!part||part==='.'||part==='..'||/[\\\x00-\x1f\x7f]/.test(part))||!parts.at(-1).toLowerCase().endsWith('.pdf'))fail('INVOICE_KEY_REQUIRED');
      if(job&&job.toLowerCase()!==parts[0].toLowerCase())fail('INVOICE_KEY_MISMATCH');
      const canonical=parts.length===2?parts[1].match(/^invoice_(\d+)\.pdf$/i):null;
      if(canonical&&number!=null&&number!==Number(canonical[1]))fail('INVOICE_KEY_MISMATCH');
      job=parts[0];if(number==null&&canonical)number=Number(canonical[1]);
    }
    requiredUuid(job);
    if(number!=null&&(!Number.isSafeInteger(number)||number<0))fail('INVOICE_NUMBER_REQUIRED');
    await jobScope(ctx,job);
    return {job,number,key,record};
  }
  async function expo(messages){
    if(!messages.length)return;
    const result=await fetcher('https://exp.host/--/api/v2/push/send',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(messages),redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!result.ok)fail('EXPO_REQUEST_REJECTED',502);
    const payload=await result.json();
    const tickets=Array.isArray(payload.data)?payload.data:[payload.data];
    if(tickets.length!==messages.length||tickets.some(ticket=>!ticket||ticket.status!=='ok'))fail('EXPO_TICKET_REJECTED',502);
  }
  async function removeQueue(id){await rest('push_queue?id=eq.'+encodeURIComponent(id),{method:'DELETE',headers:{Prefer:'return=minimal'}});}
  return {
    deleteInvoiceBundle:serve(async req=>{
      const ctx=await caller(req,{roles:['admin','manager']});const body=await req.json();
      const target=await invoiceTarget(ctx,body);
      if(!target.key&&!body.db_id&&target.number==null)fail('INVOICE_TARGET_REQUIRED');
      const output={ok:true,storage:null,db:null};
      if(target.key){
        const removed=await raw('/storage/v1/object/invoices',{method:'DELETE',body:JSON.stringify({prefixes:[target.key]})});
        if(!removed.ok)fail('INVOICE_STORAGE_DELETE_FAILED',502);
        output.storage={removed:true,key:target.key};
      }
      if(body.db_id){await rest('invoices?id=eq.'+encodeURIComponent(body.db_id),{method:'DELETE',headers:{Prefer:'return=minimal'}});output.db={by:'id',ok:true};}
      else if(target.number!=null){await rest('invoices?job_id=eq.'+encodeURIComponent(target.job)+'&invoice_no=eq.'+target.number,{method:'DELETE',headers:{Prefer:'return=minimal'}});output.db={by:'job_id+invoice_no',ok:true};}
      else output.db={by:'none',ok:true,skipped:true};
      return output;
    }),
    sendInvoiceEmail:serve(async req=>{
      const ctx=await caller(req,{roles:['admin','manager']});const body=await req.json();
      if(typeof body.to!=='string'||!body.to||/[\r\n]/.test(body.to))fail('RECIPIENT_REQUIRED');
      const target=await invoiceTarget(ctx,body);if(!target.key)fail('INVOICE_KEY_REQUIRED');
      const downloaded=await raw('/storage/v1/object/invoices/'+target.key.split('/').map(encodeURIComponent).join('/'));
      if(!downloaded.ok)fail('INVOICE_DOWNLOAD_FAILED',502);
      const bytes=new Uint8Array(await downloaded.arrayBuffer());
      let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
      const payload={to:[body.to],subject:String(body.subject||'Invoice - Sim Scope Inc.').replace(/[\r\n]+/g,' ').slice(0,200),text:String(body.text||'Please find your invoice attached.'),attachments:[{filename:target.key.split('/').pop(),mimeType:'application/pdf',base64:btoa(binary)}]};
      const sent=await raw('/functions/v1/gmail_send',{method:'POST',body:JSON.stringify(payload)},ctx.token);
      const receipt=await sent.json();if(!sent.ok||receipt.ok!==true)fail('GMAIL_INVOICE_SEND_FAILED',502);
      return {ok:true};
    }),
    pushOnMessage:serve(async req=>{
      const ctx=await caller(req,{roles:['admin','manager','tech']});const body=await req.json();
      const chat=requiredUuid(body.chatId),author=requiredUuid(body.authorProfileId);
      const chats=await rest('chats?select=id,title,org_id&id=eq.'+encodeURIComponent(chat)+'&limit=2');
      if(chats.length!==1||!ctx.service&&chats[0].org_id!==ctx.org)fail('CHAT_ORGANIZATION_REQUIRED',403);
      const authors=await rest('profiles?select=id,technician_id&id=eq.'+encodeURIComponent(author)+'&limit=2');
      if(authors.length!==1)fail('AUTHOR_REQUIRED');
      const authorTech=await technicianScope(ctx,authors[0].technician_id);
      const members=await rest('chat_members?select=member_id,org_id&chat_id=eq.'+encodeURIComponent(chat));
      if(!ctx.service&&(author!==ctx.user||authorTech.auth_user_id!==ctx.user||!members.some(member=>member.member_id===ctx.user&&member.org_id===ctx.org)))fail('CHAT_AUTHOR_MEMBERSHIP_REQUIRED',403);
      let pushed=0;
      for(const member of members){
        if(member.member_id===authorTech.auth_user_id)continue;
        const rows=await rest('profiles?select=id,badge,expo_token,technicians!inner(auth_user_id,org_id)&technicians.auth_user_id=eq.'+encodeURIComponent(member.member_id)+'&limit=2');
        if(rows.length!==1||!rows[0].expo_token)continue;
        const profile=rows[0];if(profile.technicians?.org_id!==chats[0].org_id)continue;
        const badge=(Number(profile.badge)||0)+1;
        await expo([{to:profile.expo_token,title:String(chats[0].title||'New message'),body:String(body.body||body.file_name||'New message').slice(0,2000),data:{chatId:chat},sound:'default',badge}]);
        await rest('profiles?id=eq.'+encodeURIComponent(profile.id),{method:'PATCH',body:JSON.stringify({badge}),headers:{Prefer:'return=minimal'}});pushed++;
      }
      return {ok:true,pushed};
    }),
    calendarBadge:serve(async req=>{
      const ctx=await caller(req,{roles:['admin','manager']});const body=await req.json();
      const events=Array.isArray(body)?body:[body];if(events.length>100)fail('EVENT_BATCH_TOO_LARGE');
      let pushed=0;
      for(const event of events){
        if(event?.table!=='jobs'||event.schema!=='public')continue;
        const row=event.record||event.old_record;if(!row?.technician_id)continue;
        const tech=await technicianScope(ctx,row.technician_id);
        const now=new Date(),start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())),end=new Date(start.getTime()+86400000);
        const counted=await raw('/rest/v1/jobs?select=id&technician_id=eq.'+encodeURIComponent(tech.id)+'&appointment_time=gte.'+encodeURIComponent(start.toISOString())+'&appointment_time=lt.'+encodeURIComponent(end.toISOString()),{method:'HEAD',headers:{Prefer:'count=exact'}});
        if(!counted.ok)fail('CALENDAR_COUNT_FAILED',502);
        const range=counted.headers.get('content-range')||'';const badge=Number(range.split('/')[1]);
        if(!Number.isSafeInteger(badge)||badge<0)fail('CALENDAR_COUNT_UNAVAILABLE',502);
        if(!tech.auth_user_id)continue;
        const rows=await rest('user_push_tokens?select=expo_token&user_id=eq.'+encodeURIComponent(tech.auth_user_id));
        const tokens=[...new Set(rows.map(item=>item.expo_token).filter(Boolean))];
        for(let offset=0;offset<tokens.length;offset+=99){const batch=tokens.slice(offset,offset+99);await expo(batch.map(token=>({to:token,sound:null,badge,title:'Schedule updated',body:badge>0?`You have ${badge} job(s) today`:'You have no jobs for today',data:{kind:'calendar_badge'}})));pushed+=batch.length;}
      }
      return {ok:true,pushed};
    }),
    onNewMessage:serve(async req=>{
      await caller(req,{serviceOnly:true});
      const tasks=await rest('push_queue?select=*&order=created_at.asc&limit=1');
      if(!tasks.length)return {ok:true,msg:'no tasks'};
      const task=tasks[0];const messages=await rest('chat_messages?id=eq.'+encodeURIComponent(task.message_id)+'&select=id,chat_id,author_id,body,file_url,file_name,file_type,created_at');
      if(!messages.length){await removeQueue(task.id);return {ok:true,msg:'no message'};}
      const message=messages[0];
      const rows=await rest('v_message_recipients?message_id=eq.'+encodeURIComponent(task.message_id)+'&select=recipient_id');
      const recipients=[...new Set(rows.map(row=>row.recipient_id).filter(id=>id&&id!==message.author_id))];
      if(!recipients.length){await removeQueue(task.id);return {ok:true,msg:'no recipients'};}
      const inList='in.('+recipients.map(id=>'"'+requiredUuid(id)+'"').join(',')+')';
      const tokenRows=await rest('user_push_tokens?select=expo_token,user_id&user_id='+encodeURIComponent(inList));
      const tokens=[...new Set(tokenRows.map(row=>row.expo_token).filter(Boolean))];
      if(!tokens.length){await removeQueue(task.id);return {ok:true,msg:'no tokens'};}
      for(let offset=0;offset<tokens.length;offset+=99)await expo(tokens.slice(offset,offset+99).map(token=>({to:token,sound:'default',title:'New message',body:String(message.body||message.file_name||'Attachment').slice(0,140),data:{kind:'chat',chat_id:message.chat_id,message_id:message.id},priority:'high'})));
      await removeQueue(task.id);return {ok:true,pushed:tokens.length,chunks:Math.ceil(tokens.length/99)};
    }),
  };
}
