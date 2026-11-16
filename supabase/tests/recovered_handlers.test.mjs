import assert from 'node:assert/strict';
import {createRecoveredHandlers} from '../functions/_shared/recovered_handlers.mjs';
const ids={admin:'10000000-0000-4000-8000-000000000001',manager:'10000000-0000-4000-8000-000000000002',tech:'10000000-0000-4000-8000-000000000003',other:'10000000-0000-4000-8000-000000000004',tAdmin:'20000000-0000-4000-8000-000000000001',tManager:'20000000-0000-4000-8000-000000000002',tTech:'20000000-0000-4000-8000-000000000003',tOther:'20000000-0000-4000-8000-000000000004',chat:'30000000-0000-4000-8000-000000000001',job:'40000000-0000-4000-8000-000000000001',invoice:'50000000-0000-4000-8000-000000000001',message:'60000000-0000-4000-8000-000000000001',queue:'70000000-0000-4000-8000-000000000001'};
const env={SUPABASE_URL:'http://api-gw:8000',SUPABASE_SERVICE_ROLE_KEY:'QA_SERVICE_ONLY',SUPABASE_ANON_KEY:'QA_PUBLIC_ANON',HVAC_OAUTH_APP_ORIGIN:'https://hvac-app-jade.vercel.app'};
const checks=[];function check(name,value){checks.push({name,passed:!!value});assert.ok(value,name);}
function fixture(options={}){
 const state={storageDeletes:[],dbDeletes:[],gmail:[],expo:[],queueDeletes:0,badges:[],requests:[],...options};
 const fetcher=async(url,init={})=>{
  const parsed=new URL(url),p=parsed.pathname,q=parsed.searchParams,method=init.method||'GET';
  const authorization=init.headers?.Authorization||'';const rawActor=authorization.replace('Bearer JWT_','');const actor=rawActor==='technician'?'tech':rawActor;
  state.requests.push({path:p,method,actor});
  if(url==='https://exp.host/--/api/v2/push/send'){
   const messages=JSON.parse(init.body);state.expo.push(...messages);
   return Response.json({data:messages.map(()=>state.expoTicketError?{status:'error',details:{error:'DeviceNotRegistered'}}:{status:'ok',id:'QA_TICKET'})},{status:state.expoHttpError?502:200});
  }
  if(p==='/auth/v1/user')return ids[actor]?Response.json({id:ids[actor]}):Response.json({error:'invalid'},{status:401});
  if(p==='/rest/v1/rpc/hvac_live_caller_context')return Response.json(actor==='other'||state.expired?null:{user:ids[actor],session:'QA_LIVE_SESSION',role:actor,org:1});
  if(p==='/functions/v1/gmail_send'){
   state.gmail.push({payload:JSON.parse(init.body),authorization});
   return Response.json({ok:!state.gmailError,id:'QA_MOCK_MAIL_ID'},{status:state.gmailError?502:200});
  }
  if(p==='/storage/v1/object/invoices'&&method==='DELETE'){state.storageDeletes.push(JSON.parse(init.body));return Response.json([]);}
  if(p.startsWith('/storage/v1/object/invoices/')&&method==='GET')return new Response(new TextEncoder().encode('QA SYNTHETIC PDF BYTES'),{headers:{'Content-Type':'application/pdf'}});
  if(p==='/rest/v1/invoices'){
   if(method==='DELETE'){state.dbDeletes.push(q.toString());return new Response(null,{status:204});}
   return Response.json([{id:ids.invoice,job_id:ids.job,invoice_no:22}]);
  }
  if(p==='/rest/v1/jobs'){
   if(method==='HEAD')return new Response(null,{headers:{'Content-Range':'*/3'}});
   return Response.json([{id:ids.job,technician_id:state.foreignJob?ids.tOther:ids.tTech}]);
  }
  if(p==='/rest/v1/technicians'){
   const id=q.get('id').slice(3);const actor=id===ids.tTech?'tech':id===ids.tManager?'manager':id===ids.tAdmin?'admin':'other';
   return Response.json([{id,org_id:actor==='other'?2:1,auth_user_id:ids[actor]}]);
  }
  if(p==='/rest/v1/chats')return Response.json([{id:ids.chat,title:'QA Chat',org_id:state.foreignChat?2:1}]);
  if(p==='/rest/v1/chat_members')return Response.json(state.nonmember?[]:[{member_id:ids.tech,org_id:1},{member_id:ids.manager,org_id:1}]);
  if(p==='/rest/v1/profiles'){
   if(method==='PATCH'){state.badges.push({id:q.get('id'),body:JSON.parse(init.body)});return new Response(null,{status:204});}
   if(q.has('technicians.auth_user_id'))return Response.json([{id:ids.manager,badge:2,expo_token:'ExpoPushToken[QA_SYNTHETIC_ONLY]',technicians:{auth_user_id:ids.manager,org_id:1}}]);
   const id=q.get('id').slice(3);return Response.json([{id,technician_id:id===ids.tech?ids.tTech:ids.tManager}]);
  }
  if(p==='/rest/v1/push_queue'){
   if(method==='DELETE'){state.queueDeletes++;return new Response(null,{status:204});}
   return Response.json(state.noTasks?[]:[{id:ids.queue,message_id:ids.message}]);
  }
  if(p==='/rest/v1/chat_messages')return Response.json([{id:ids.message,chat_id:ids.chat,author_id:ids.tech,body:'QA MESSAGE'}]);
  if(p==='/rest/v1/v_message_recipients')return Response.json([{recipient_id:ids.manager}]);
  if(p==='/rest/v1/user_push_tokens')return Response.json([{user_id:ids.manager,expo_token:'ExpoPushToken[QA_SYNTHETIC_ONLY]'}]);
  throw new Error('UNMOCKED_REQUEST_'+p);
 };
 const handlers=createRecoveredHandlers({getenv:name=>env[name],fetcher});
 const call=(name,actor,body,method='POST')=>handlers[name](new Request('https://api.local/'+name,{method,headers:{origin:env.HVAC_OAUTH_APP_ORIGIN,...(actor?{Authorization:'Bearer '+(actor==='service'?env.SUPABASE_SERVICE_ROLE_KEY:'JWT_'+actor)}:{}),'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})}));
 return {state,call};
}
const invoice={bucket:'invoices',job_id:ids.job,invoice_no:22,db_id:ids.invoice,key:ids.job+'/invoice_22.pdf'};
let f=fixture(),r=await f.call('deleteInvoiceBundle','manager',invoice);check('manager_bundle_deletes_exact_invoice_and_key',r.status===200&&f.state.storageDeletes.length===1&&f.state.storageDeletes[0].prefixes[0]===invoice.key&&f.state.dbDeletes.length===1);
check('invoice_reads_use_caller_RLS',f.state.requests.filter(x=>x.method==='GET'&&['/rest/v1/jobs','/rest/v1/invoices'].includes(x.path)).every(x=>x.actor==='manager'));
f=fixture();r=await f.call('deleteInvoiceBundle','tech',invoice);check('tech_bundle_denied_without_delete',r.status===403&&f.state.storageDeletes.length===0&&f.state.dbDeletes.length===0);
f=fixture({expired:true});r=await f.call('deleteInvoiceBundle','admin',invoice);check('expired_session_denied_without_delete',r.status===403&&f.state.storageDeletes.length===0);
f=fixture();r=await f.call('deleteInvoiceBundle','admin',{...invoice,key:ids.job+'/invoice_99.pdf'});check('mismatched_invoice_key_denied',r.status===400&&f.state.storageDeletes.length===0);
f=fixture();r=await f.call('deleteInvoiceBundle','admin',{...invoice,bucket:'job-photos'});check('arbitrary_bucket_denied',r.status===400&&f.state.storageDeletes.length===0);
f=fixture({foreignJob:true});r=await f.call('deleteInvoiceBundle','admin',invoice);check('cross_org_invoice_job_denied',r.status===403&&f.state.storageDeletes.length===0);
f=fixture();r=await f.call('sendInvoiceEmail','manager',{...invoice,to:'qa@local.invalid',subject:'QA INVOICE',text:'QA ONLY'});check('invoice_wrapper_uses_existing_gmail_send',r.status===200&&f.state.gmail.length===1&&f.state.gmail[0].authorization==='Bearer JWT_manager'&&f.state.gmail[0].payload.attachments[0].filename==='invoice_22.pdf');
check('invoice_wrapper_attachment_bytes_match',Buffer.from(f.state.gmail[0].payload.attachments[0].base64,'base64').toString()==='QA SYNTHETIC PDF BYTES');
f=fixture();r=await f.call('sendInvoiceEmail','manager',{...invoice,key:ids.job+'/archive/QA invoice revision.PDF',to:'qa@local.invalid'});check('legacy_noncanonical_pdf_wrapper_contract_preserved',r.status===200&&f.state.gmail[0].payload.attachments[0].filename==='QA invoice revision.PDF');
f=fixture();r=await f.call('deleteInvoiceBundle','manager',{...invoice,key:ids.job+'/invoice_22_revision.pdf'});check('legacy_noncanonical_pdf_delete_contract_preserved',r.status===200&&f.state.storageDeletes[0].prefixes[0].endsWith('/invoice_22_revision.pdf'));
f=fixture();r=await f.call('deleteInvoiceBundle','manager',{...invoice,key:ids.job+'/../invoice.pdf'});check('legacy_pdf_traversal_still_denied',r.status===400&&f.state.storageDeletes.length===0);
f=fixture();r=await f.call('sendInvoiceEmail','tech',{...invoice,to:'qa@local.invalid'});check('tech_cannot_send_invoice',r.status===403&&f.state.gmail.length===0);
f=fixture({gmailError:true});r=await f.call('sendInvoiceEmail','admin',{...invoice,to:'qa@local.invalid'});check('gmail_failure_not_reported_as_success',r.status===502);
const chat={chatId:ids.chat,authorProfileId:ids.tech,body:'QA MESSAGE'};
f=fixture();r=await f.call('pushOnMessage','tech',chat);check('chat_author_member_can_push',r.status===200&&f.state.expo.length===1&&f.state.expo[0].data.chatId===ids.chat&&f.state.expo[0].badge===3&&f.state.badges.length===1);
check('chat_author_is_not_notified',f.state.expo[0].to==='ExpoPushToken[QA_SYNTHETIC_ONLY]');
f=fixture();r=await f.call('pushOnMessage','technician',chat);check('real_technician_role_normalizes_to_chat_tech_contract',r.status===200&&f.state.expo.length===1);
f=fixture();r=await f.call('pushOnMessage','tech',{...chat,authorProfileId:ids.manager});check('forged_chat_author_denied',r.status===403&&f.state.expo.length===0&&f.state.badges.length===0);
f=fixture({nonmember:true});r=await f.call('pushOnMessage','tech',chat);check('chat_nonmember_denied',r.status===403&&f.state.expo.length===0);
f=fixture({foreignChat:true});r=await f.call('pushOnMessage','tech',chat);check('cross_org_chat_denied',r.status===403&&f.state.expo.length===0);
f=fixture({expoTicketError:true});r=await f.call('pushOnMessage','tech',chat);check('chat_expo_ticket_error_fails_closed',r.status===502&&f.state.badges.length===0);
const badge={type:'UPDATE',schema:'public',table:'jobs',record:{id:ids.job,technician_id:ids.tTech},old_record:null};
f=fixture();r=await f.call('calendarBadge','manager',badge);check('calendar_staff_recomputes_current_UTC_badge',r.status===200&&f.state.expo.length===1&&f.state.expo[0].badge===3&&f.state.expo[0].data.kind==='calendar_badge');
f=fixture();r=await f.call('calendarBadge','tech',badge);check('tech_cannot_forge_job_webhook',r.status===403&&f.state.expo.length===0);
f=fixture();r=await f.call('calendarBadge','admin',{...badge,record:{technician_id:ids.tOther}});check('calendar_other_org_technician_denied',r.status===403&&f.state.expo.length===0);
f=fixture();r=await f.call('calendarBadge','service',badge);check('verified_service_job_webhook_supported',r.status===200&&f.state.expo.length===1);
f=fixture();r=await f.call('onNewMessage','manager',{});check('queue_worker_rejects_ordinary_staff',r.status===403&&f.state.queueDeletes===0&&f.state.expo.length===0);
f=fixture({noTasks:true});r=await f.call('onNewMessage','service',{});check('service_queue_empty_does_not_send',r.status===200&&f.state.expo.length===0);
f=fixture();r=await f.call('onNewMessage','service',{});check('service_queue_sends_then_acknowledges',r.status===200&&f.state.expo.length===1&&f.state.queueDeletes===1&&f.state.expo[0].data.message_id===ids.message);
f=fixture({expoHttpError:true});r=await f.call('onNewMessage','service',{});check('queue_preserved_on_provider_http_failure',r.status===502&&f.state.queueDeletes===0);
f=fixture({expoTicketError:true});r=await f.call('onNewMessage','service',{});check('queue_preserved_on_provider_ticket_failure',r.status===502&&f.state.queueDeletes===0);
f=fixture();r=await f.call('pushOnMessage',null,chat);check('missing_authorization_401_no_provider',r.status===401&&f.state.expo.length===0);
assert.throws(()=>createRecoveredHandlers({getenv:name=>name==='HVAC_LOCAL_PUSH_SINK'?'http://fake-sink':env[name],fetcher:async()=>{throw Error('NO_NETWORK');}}),/PRODUCTION_PUSH_SINK_FORBIDDEN/);check('production_fake_sink_rejected',true);
console.log(JSON.stringify({status:'PASS',checks,provider:'MOCK_EXPO_AND_GMAIL_ONLY',emails_sent:0,real_pushes_sent:0,business_database_changes:0},null,2));
