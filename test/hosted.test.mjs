import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBackend} from './backend-harness.mjs';
import {createBridge,signRequest,validateBridgeConfig} from '../lib/bridge.mjs';
import {createApp,configFromEnv} from '../server.mjs';
const backendUrl='https://script.google.com/macros/s/TEST_DEPLOYMENT/exec';
const origin='http://family.example';
async function running(t,backend=createBackend()){
  const bridge=createBridge({backendUrl,secret:backend.secret,fetchImpl:backend.fetchImpl});
  const server=createApp({origin,secure:false,bridge});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port;
  const post=(body,cookie='',headers={})=>fetch(base+'/api',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Family-Request':'1',...(cookie?{Cookie:cookie}:{}),...headers},body:JSON.stringify(body)});
  const login=async (name='Household admin',key=backend.ownerKey)=>{const response=await post({action:'login',name,key});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];return {cookie,response};};
  return {backend,bridge,server,base,post,login};
}
test('bridge signs requests, follows only Google content redirects, and rejects replay/tampering/stale envelopes',async()=>{
  const b=createBackend(),bridge=createBridge({backendUrl,secret:b.secret,fetchImpl:b.fetchImpl});
  const good=signRequest({action:'connection'},b.secret);assert.equal(b.direct(good).ok,true);assert.equal(b.direct(good).ok,false);
  const tampered=signRequest({action:'connection'},b.secret);tampered.payload='{"action":"state"}';assert.equal(b.direct(tampered).ok,false);
  assert.equal(b.direct(signRequest({action:'connection'},b.secret,{timestamp:Date.now()-600001})).ok,false);
  const result=await bridge({action:'connection'});assert.equal(result.result.spreadsheetReady,true);
  let secondCall=false;
  const bad=createBridge({backendUrl,secret:b.secret,fetchImpl:async()=>{if(secondCall)throw new Error('Must not follow');secondCall=true;return new Response(null,{status:302,headers:{location:'https://accounts.google.com/login'}});}});
  await assert.rejects(bad({action:'connection'}),/executes as its owner/);
  const wrong=createBridge({backendUrl,secret:'a'.repeat(64),fetchImpl:b.fetchImpl});assert.equal((await wrong({action:'connection'})).error.code,'BRIDGE_ERROR');
});
test('hosting secret setup preserves existing codes and all 58 seeded tasks',()=>{
  const b=createBackend();assert.equal(b.sheets.Tasks.data.length-1,58);const first=b.secret,codes=JSON.stringify(b.sheets.Members.data);
  b.ctx.showHostingConnection();assert.equal(b.props.get('HOSTING_SECRET'),first);assert.equal(JSON.stringify(b.sheets.Members.data),codes);
  assert.equal(typeof b.ctx.api,'undefined');assert.equal(typeof b.ctx.api_,'function');
});
test('hosted login uses HttpOnly cookie; codes and session tokens are not returned to browser JavaScript',async t=>{
  const app=await running(t),unauth=await app.post({action:'state',token:'a'.repeat(64)});assert.equal(unauth.status,401);
  const incorrect=await app.post({action:'login',name:'Household admin',key:'wrong'});assert.equal(incorrect.status,401);
  const {cookie,response}=await app.login(),body=await response.json();assert.deepEqual(body,{ok:true,result:{signedIn:true}});
  assert.match(response.headers.get('set-cookie'),/HttpOnly/);assert.match(response.headers.get('set-cookie'),/SameSite=Strict/);
  const state=await (await app.post({action:'state'},cookie)).json();assert.equal(state.result.tasks.length,58);assert.equal(state.result.me.name,'Household admin');assert(!JSON.stringify(state).includes('keyHash'));
  const logout=await app.post({action:'logout'},cookie);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await app.post({action:'state'},cookie)).status,401);
});
test('wrong origins, untrusted bodies and private files are blocked; public assets contain no Google calls',async t=>{
  const app=await running(t);
  assert.equal((await app.post({action:'login',name:'x',key:'y'},'',{Origin:'https://evil.example'})).status,403);
  assert.equal((await app.post({action:'state'},'',{'X-Family-Request':''})).status,403);
  assert.equal((await app.post({action:'state'},'',{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await fetch(app.base+'/api')).status,405);
  assert.equal((await app.post({action:'connection'})).status,400);
  assert.equal((await app.post([])).status,400);
  for(const path of ['/.env','/server.mjs','/google-apps-script/Code.gs','/lib/bridge.mjs'])assert.equal((await fetch(app.base+path)).status,404);
  const html=await fetch(app.base+'/');assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/connect-src 'self'/);
  const js=await (await fetch(app.base+'/app.js')).text();assert(!/google\.script|script\.google|sessionStorage|HOSTING_SECRET/.test(js));
  assert.equal((await fetch(app.base+'/healthz')).status,200);
  const huge=await app.post({action:'addTasks',data:{text:'x'.repeat(140000)}});assert.equal(huge.status,413);
});
test('hosted member voting, avatars, planning, completion, hours and access-code rotation work against preserved Sheets logic',async t=>{
  const app=await running(t),{cookie}=await app.login();
  const call=async(action,data={},auth=cookie)=>{const response=await app.post({action,data},auth),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result.result;};
  const member=await call('addMember',{name:'Child helper'}),child=(await app.login(member.name,member.key)).cookie;
  assert.equal((await app.post({action:'plan'},child)).status,400);
  await call('profile',{hours:4,skill:2,avatar:'frog'});await call('profile',{hours:2,skill:0,avatar:'bee'},child);
  let state=await call('state'),task=state.tasks[0],week=state.week;
  const vote={taskId:task.id,priority:4,frequency:'Weekly',minutes:30,skill:0};
  await call('vote',vote);assert.equal((await call('state')).tasks[0].consensus.ready,false);await call('vote',vote,child);assert.equal((await call('state')).tasks[0].consensus.ready,true);
  const plan=await call('plan',{week});assert.equal(plan.additions.length,1);assert.equal((await call('plan',{week})).additions.length,0);
  for(const id of Object.keys(plan.loads))assert(plan.loads[id]<=plan.capacity[id]);
  await call('assignment',{id:plan.additions[0].id,operation:'complete',actual:24});
  state=await call('state');assert.equal(state.assignments[0].status,'done');assert.equal(state.me.avatar,'frog');assert.equal(state.members.find(m=>m.id!==state.me.id).avatar,'bee');
  await call('vote',{...vote,frequency:'Monthly'},child);assert.equal((await call('state')).tasks[0].consensus.ready,false);await call('resolve',vote);assert.equal((await call('state')).tasks[0].consensus.ready,true);
  await call('availability',{week,hours:0},child);assert.equal((await call('state')).preview.capacity[state.members.find(m=>m.name==='Child helper').id],0);
  assert.equal((await call('addTasks',{text:'New garden task\nNew garden task'})).added,1);
  await call('archive',{taskId:task.id,archived:true});await call('archive',{taskId:task.id,archived:false});
  await call('memberAccess',{id:state.members.find(m=>m.name==='Child helper').id,reset:true});assert.equal((await app.post({action:'state'},child)).status,401);
});
test('connection failures do not leak details, and logout still clears a Secure cookie',async t=>{
  const secureOrigin='https://family.example';
  const server=createApp({origin:secureOrigin,secure:true,bridge:async()=>{throw new Error('secret value should not leak');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const url='http://127.0.0.1:'+server.address().port+'/api';
  const send=(body,cookie='')=>fetch(url,{method:'POST',headers:{Origin:secureOrigin,'Content-Type':'application/json','X-Family-Request':'1',Cookie:cookie},body:JSON.stringify(body)});
  const login=await send({action:'login',name:'Parent',key:'irrelevant'});assert.equal(login.status,500);assert(!(await login.text()).includes('secret value'));
  const logout=await send({action:'logout'},'family_session='+'a'.repeat(64));assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0; Secure/);
});
test('production configuration requires HTTPS and validates the private Google endpoint',()=>{
  assert.throws(()=>validateBridgeConfig({backendUrl:'https://evil.example/x',secret:'a'.repeat(64)}));
  assert.throws(()=>validateBridgeConfig({backendUrl,secret:'short'}));
  assert.throws(()=>configFromEnv({NODE_ENV:'production'}),/PUBLIC_ORIGIN/);
  assert.throws(()=>createApp({origin:'http://family.example',secure:true,bridge:async()=>{}}),/HTTPS/);
  assert.equal(configFromEnv({NODE_ENV:'production',RENDER_EXTERNAL_URL:'https://family.onrender.com'}).origin,'https://family.onrender.com');
});
