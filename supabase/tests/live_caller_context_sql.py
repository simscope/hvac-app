"""Run with Docker access to an authorized restored Hvac fixture database.

Example: python supabase/tests/live_caller_context_sql.py --container hvac-validation-db
The test uses temporary Auth session rows inside rolled-back transactions.
It never needs passwords, signs a JWT, sends a message, or changes public data.
"""
import argparse
import json
import subprocess
import uuid

parser=argparse.ArgumentParser()
parser.add_argument('--docker',default='docker')
parser.add_argument('--container',default='hvac-validation-db')
args=parser.parse_args()

def sql(statement):
    result=subprocess.run([args.docker,'exec','-i',args.container,'psql','-U','supabase_admin','-d','postgres','-XqAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse'],input=statement,capture_output=True,text=True,encoding='utf-8',timeout=30)
    if result.returncode:raise RuntimeError('SQL regression command failed; inspect the authorized database privately')
    return result.stdout.strip()

actors=json.loads(sql("SELECT json_agg(t) FROM (SELECT u.id,p.role::text role,p.technician_id,t.org_id,coalesce(t.is_active,true) active FROM auth.users u JOIN public.profiles p ON p.id=u.id JOIN public.technicians t ON t.id=p.technician_id JOIN hvac_guard.oauth_mailboxes b ON b.name='hvac-gmail' AND b.org_id=t.org_id WHERE p.role::text IN ('admin','manager','tech','technician') ORDER BY u.id)t;"))
assert actors and len(actors)>=3,'Restore admin, manager and technician fixture users first'
roles={'tech' if actor['role']=='technician' else actor['role'] for actor in actors}
assert {'admin','manager','tech'}<=roles,'The restored fixture must cover admin, manager and technician roles'
before=int(sql('SELECT count(*) FROM auth.sessions;'));checks=[]
for actor in actors:
    actor_id=str(uuid.UUID(actor['id']));session=str(uuid.uuid4())
    other=str(uuid.UUID(next(item['id'] for item in actors if item['id']!=actor_id)))
    role='tech' if actor['role']=='technician' else actor['role'];org=int(actor['org_id'])
    claims=lambda user,identifier:json.dumps({'sub':user,'role':'authenticated','session_id':identifier,'user_metadata':{'role':'FORGED_ADMIN','org_id':999}},separators=(',',':')).replace("'","''")
    expected='true' if actor['active'] else 'false'
    statement="BEGIN; INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after) VALUES ('"+session+"','"+actor_id+"',now(),now(),now()+interval '1 hour'); SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='"+claims(actor_id,session)+"'; SELECT json_build_object('own_context_expected',((public.hvac_live_caller_context() IS NOT NULL)="+expected+"),'database_role_not_metadata',coalesce(public.hvac_live_caller_context()->>'role'='"+role+"',NOT "+expected+"),'database_org_not_metadata',coalesce((public.hvac_live_caller_context()->>'org')::integer="+str(org)+",NOT "+expected+")); SET LOCAL request.jwt.claims='"+claims(other,session)+"'; SELECT json_build_object('other_user_session_rejected',public.hvac_live_caller_context() IS NULL); SET LOCAL request.jwt.claims='"+claims(actor_id,str(uuid.uuid4()))+"'; SELECT json_build_object('missing_session_rejected',public.hvac_live_caller_context() IS NULL); RESET ROLE; UPDATE auth.sessions SET not_after=now()-interval '1 hour' WHERE id='"+session+"'; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='"+claims(actor_id,session)+"'; SELECT json_build_object('expired_session_rejected',public.hvac_live_caller_context() IS NULL); ROLLBACK;"
    result=[json.loads(line) for line in sql(statement).splitlines()]
    assert all(all(item.values()) for item in result),'Live-session authorization regression'
    checks.append({'source_role':actor['role'],'normalized_role':role,'checks':result})
assert before==int(sql('SELECT count(*) FROM auth.sessions;')),'Auth session fixtures were not rolled back'
acl=json.loads(sql("SELECT json_build_object('wrapper_anon_execute',has_function_privilege('anon','public.hvac_live_caller_context()','execute'),'wrapper_authenticated_execute',has_function_privilege('authenticated','public.hvac_live_caller_context()','execute'),'inner_anon_execute',has_function_privilege('anon','hvac_guard.live_caller_context()','execute'),'public_executable_private_functions',(SELECT count(*) FROM pg_proc p WHERE p.pronamespace='hvac_guard'::regnamespace AND EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')));"))
assert acl=={'wrapper_anon_execute':False,'wrapper_authenticated_execute':True,'inner_anon_execute':False,'public_executable_private_functions':0}
print(json.dumps({'status':'PASS','actors_tested':len(actors),'checks':checks,'private_function_acl':acl,'auth_session_fixtures_rolled_back':True,'second_organization_live_tested':False,'emails_sent':0,'real_pushes_sent':0},indent=2))
