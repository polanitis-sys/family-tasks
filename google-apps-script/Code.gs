/* Family Tasks — Google Sheets + Apps Script. All data functions are private;
   doPost() accepts signed requests from the separately hosted server. */
const TABLES_ = {
  Members:['id','name','keyHash','active','admin','hours','skill'],
  Tasks:['id','title','notes','category','created','archived'],
  Votes:['id','memberId','taskId','priority','frequency','minutes','skill','updated'],
  Availability:['id','memberId','week','hours'],
  Assignments:['id','taskId','memberId','week','due','minutes','status','actual','completed','title'],
  Decisions:['id','taskId','fingerprint','priority','frequency','minutes','skill'],
  Settings:['id','value']
};
const AVATAR_IDS_ = ['fox','frog','bee','bunny','koala','owl','hedgehog','ladybird','butterfly','sunflower','mushroom','sprout'];
const FREQ_ = {'Once':0,'Daily':1,'3 times a week':2,'Weekly':7,'Fortnightly':14,'Monthly':30,'Quarterly':90,'Annually':365};
const SEED_ = ["Fix wood rot on pergola", "Fix wood rot gate", "Fix wood rot on garage door", "Fix wood rot on rails upper balcony", "Sweep outside - Deck", "Sweep outside - paving, paths and large rock area", "Prune plants", "Fix trimming boards inside (the missing boards and those that pop out)", "Fix gutter down pipes", "Clean gutters and roof", "Diagnose blocked pipe", "Fix side door under house", "Get rid of old bikes", "Review roof tiles", "Fix extractor fan", "Reseal tile upstairs bathroom", "Reseal tiles in bathrooms (annual)", "Sand and treat dining table", "Paint brown trim internal - see white splashes", "Paint white walls internal", "Paint exterior trim", "Build thing to block possum", "Build additional sun blind", "Fix light switch on dining room", "Fix blind cords", "Paint chimney internal - flaked paint", "Fix garage roof - temporary fix", "Fix tree stump and then path at side of house - remove stump, reconcrete path", "Fix wood trim in bathroom", "Repaint internal doors", "Fix downstairs door handle", "Paint upstairs bathroom", "Fix curtain rail in upstairs bathroom", "Replace Emily’s skylight", "Replace walk in wardrobe", "Pavers near garden beds", "Mow lawn", "Trim grass near edge", "Rake and whipper snipper fire break", "Thin bush near property", "Rubbish under deck", "Scrub deck clean", "Paint/treat deck", "Treat outdoor furniture", "Wash and clean car", "Clean garage", "Deep Clean laundry", "Deep clean kitchen cupboards", "Deep clean bathrooms", "Deep clean bedrooms", "Mulch", "Weed garden front", "Weed garden Marako", "Weed garden side", "Weed garden kitchen", "Weed garden back", "Maintain compost heap", "Wash windows"];
function onOpen() { SpreadsheetApp.getUi().createMenu('Family Tasks').addItem('Set up / recover administrator access','setupHousehold').addItem('Enable Monday automatic planning','enableWeeklyPlanning').addItem('Disable automatic planning','disableWeeklyPlanning').addItem('Show hosting connection secret','showHostingConnection').addToUi(); }
function setupHousehold() {
  // A bound spreadsheet is unavailable to anonymous web RPC calls.
  if (!Session.getActiveUser().getEmail() || Session.getActiveUser().getEmail() !== Session.getEffectiveUser().getEmail()) throw new Error('Open this function from the spreadsheet owner’s account.');
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  if(!ss) throw new Error('Run setupHousehold from the spreadsheet’s Extensions → Apps Script editor.');
  const props=PropertiesService.getScriptProperties();
  if(props.getProperty('SHEET_ID') && props.getProperty('SHEET_ID')!==ss.getId()) throw new Error('This project is already linked to another spreadsheet.');
  props.setProperty('SHEET_ID',ss.getId());
  ss.setSpreadsheetTimeZone('Australia/Sydney');
  const result=locked_(()=>{
    Object.keys(TABLES_).forEach(name=>{if(!ss.getSheetByName(name)){let sh=ss.insertSheet(name);sh.appendRow(TABLES_[name]);sh.setFrozenRows(1);sh.getRange(1,1,1,TABLES_[name].length).setBackground('#173e35').setFontColor('#ffffff').setFontWeight('bold');sh.autoResizeColumns(1,TABLES_[name].length);}});
    if(!rows_('Settings').some(x=>x.id==='seeded')){SEED_.forEach(title=>append_('Tasks',{id:uid_(),title,notes:'',category:'',created:today_(),archived:false}));append_('Settings',{id:'seeded',value:'yes'});append_('Settings',{id:'buffer',value:0.8});}
    let owner=rows_('Members').find(m=>m.admin===true);
    const key=uid_()+uid_();
    if(owner){owner.keyHash=hash_(key);owner.active=true;put_('Members',owner);} else {owner={id:uid_(),name:'Household admin',keyHash:hash_(key),active:true,admin:true,hours:0,skill:0};append_('Members',owner);}
    return {name:owner.name,key};
  });
  SpreadsheetApp.getUi().alert('Administrator access', 'Name: '+result.name+'\n\nAccess code: '+result.key+'\n\nSave this private code. Existing tasks and votes are preserved. Deploy as a web app next (see README).',SpreadsheetApp.getUi().ButtonSet.OK);
}
function doGet(){return HtmlService.createHtmlOutput('<h1>Family Tasks</h1><p>Your family app now has a separate website address. Ask your household administrator for that address.</p>').setTitle('Family Tasks connection');}
function api_(request) {
  request=request||{};
  return locked_(()=>{
    if(request.action==='login') return login_(request);
    const member=authenticate_(request.token);
    if(request.action==='logout'){CacheService.getScriptCache().remove('session:'+hash_(request.token));return {ok:true};}
    const p=request.data||{};
    if(request.action==='state') return state_(member,p.week);
    if(request.action==='vote') {
      task_(p.taskId);const priority=number_(p.priority,1,5),minutes=number_(p.minutes,1,10080),skill=number_(p.skill,0,3);
      if(!Number.isInteger(priority)||!Number.isInteger(skill)||!Object.prototype.hasOwnProperty.call(FREQ_,p.frequency))throw new Error('Choose valid ratings for all four fields.');
      put_('Votes',{id:member.id+':'+p.taskId,memberId:member.id,taskId:p.taskId,priority,frequency:p.frequency,minutes,skill,updated:new Date().toISOString()});
    } else if(request.action==='addTasks') {
      const titles=String(p.text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
      if(!titles.length||titles.length>300)throw new Error('Enter 1–300 tasks, one per line.');
      if(titles.some(x=>x.length>300))throw new Error('Task names must be at most 300 characters.');
      const existing=new Set(rows_('Tasks').map(t=>t.title.toLowerCase()));let added=0;
      titles.forEach(title=>{if(!existing.has(title.toLowerCase())){append_('Tasks',{id:uid_(),title,notes:'',category:'',created:today_(),archived:false});existing.add(title.toLowerCase());added++;}});
      return {added};
    } else if(request.action==='profile') {
      member.hours=number_(p.hours,0,100);member.skill=number_(p.skill,0,2);
      if(p.avatar!==undefined&&!AVATAR_IDS_.includes(p.avatar))throw new Error('Choose one of the garden buddies.');
      if(!Number.isInteger(member.skill))throw new Error('Select a valid skill level.');
      if(p.name!==undefined){const name=text_(p.name,60);if(rows_('Members').some(m=>m.id!==member.id&&m.name.toLowerCase()===name.toLowerCase()))throw new Error('This name is already used.');member.name=name;}
      put_('Members',member);
      if(p.avatar!==undefined)put_('Settings',{id:'avatar:'+member.id,value:p.avatar});
    } else if(request.action==='availability') {
      const week=monday_(p.week);put_('Availability',{id:member.id+':'+week,memberId:member.id,week,hours:number_(p.hours,0,100)});
    } else if(request.action==='addMember') {
      admin_(member);const name=text_(p.name,60);if(rows_('Members').some(m=>m.name.toLowerCase()===name.toLowerCase()))throw new Error('This name is already used.');
      const key=uid_()+uid_();append_('Members',{id:uid_(),name,keyHash:hash_(key),active:true,admin:false,hours:0,skill:0});return {name,key};
    } else if(request.action==='memberAccess') {
      admin_(member);const target=rows_('Members').find(m=>m.id===p.id);if(!target||target.admin)throw new Error('Choose a non-administrator member.');
      if(p.reset){const key=uid_()+uid_();target.keyHash=hash_(key);put_('Members',target);return {name:target.name,key};}
      target.active=p.active===true;put_('Members',target);
    } else if(request.action==='resolve') {
      admin_(member);const data=data_(),task=task_(p.taskId),spec=consensus_(task,data);
      if(!spec.allVoted)throw new Error('Everyone must vote before resolving a task.');
      if(!Object.prototype.hasOwnProperty.call(FREQ_,p.frequency))throw new Error('Choose a frequency.');
      const priority=number_(p.priority,1,5),skill=number_(p.skill,0,3);if(!Number.isInteger(priority)||!Number.isInteger(skill))throw new Error('Choose valid ratings.');
      put_('Decisions',{id:task.id,taskId:task.id,fingerprint:spec.fingerprint,priority,frequency:p.frequency,minutes:number_(p.minutes,1,10080),skill});
    } else if(request.action==='plan') {
      admin_(member);const week=monday_(p.week);if(week<monday_(today_()))throw new Error('Generate a plan for this week or a future week.');
      const d=data_(),plan=plan_(d,week);plan.additions.forEach(a=>append_('Assignments',a));return plan;
    } else if(request.action==='assignment') {
      const d=data_(),a=d.Assignments.find(x=>x.id===p.id);if(!a)throw new Error('Assignment not found.');
      if(!member.admin&&a.memberId!==member.id)throw new Error('Only the assigned member or administrator can change this task.');
      if(p.operation==='complete'){if(a.status!=='planned')throw new Error('This occurrence is already closed.');a.status='done';a.actual=p.actual===''||p.actual===undefined?'':number_(p.actual,1,10080);a.completed=today_();}
      else if(p.operation==='reassign'){
        if(a.status!=='planned')throw new Error('Only planned work can be reassigned.');
        const target=d.Members.find(m=>m.id===p.memberId&&m.active);if(!target)throw new Error('Choose an active member.');
        const t=d.Tasks.find(t=>t.id===a.taskId),s=consensus_(t,d);if(!s.ready||s.skill===3||target.skill<s.skill)throw new Error('This member does not meet the agreed expertise requirement, or the task needs review.');
        const hrs=hours_(target,a.week,d)*0.8,used=d.Assignments.filter(x=>x.week===a.week&&x.memberId===target.id&&x.id!==a.id&&x.status!=='cancelled').reduce((s,x)=>s+Number(x.minutes),0);
        if(used+Number(a.minutes)>hrs*60+0.001)throw new Error('This would exceed the member’s buffered weekly availability.');a.memberId=target.id;
      } else if(p.operation==='cancel'){if(!member.admin)throw new Error('Administrator access required.');if(a.status!=='planned')throw new Error('Only planned work can be cancelled.');a.status='cancelled';}
      else throw new Error('Unknown assignment operation.');put_('Assignments',a);
    } else if(request.action==='archive') {admin_(member);const t=rows_('Tasks').find(t=>t.id===p.taskId);if(!t)throw new Error('Task not found.');t.archived=p.archived===true;put_('Tasks',t);}
    else throw new Error('Unknown action.');
    return {ok:true};
  });
}
function login_(p) {
  const name=String(p.name||'').trim().toLowerCase(),cache=CacheService.getScriptCache(),rate='login:'+hash_(name),attempts=Number(cache.get(rate)||0);
  if(attempts>=10)throw new Error('Too many attempts. Try again in 15 minutes.');
  const member=rows_('Members').find(m=>m.active&&m.name.toLowerCase()===name&&m.keyHash===hash_(String(p.key||'').trim()));
  if(!member){cache.put(rate,String(attempts+1),900);throw new Error('Name or access code is incorrect.');}
  cache.remove(rate);const token=uid_()+uid_();cache.put('session:'+hash_(token),JSON.stringify({id:member.id,keyHash:member.keyHash}),21600);return {token};
}
function authenticate_(token){if(!token||typeof token!=='string')throw new Error('Please sign in.');const raw=CacheService.getScriptCache().get('session:'+hash_(token));if(!raw)throw new Error('Session expired. Please sign in again.');const session=JSON.parse(raw),member=rows_('Members').find(m=>m.id===session.id&&m.active&&m.keyHash===session.keyHash);if(!member)throw new Error('Access has changed. Please sign in again.');return member;}
function state_(member,week){const d=data_();week=monday_(week||today_());return {me:publicMember_(member,d.Settings),members:d.Members.map(m=>publicMember_(m,d.Settings)),week,today:today_(),frequencies:Object.keys(FREQ_),tasks:d.Tasks.map(t=>Object.assign({},t,{consensus:consensus_(t,d),myVote:d.Votes.find(v=>v.taskId===t.id&&v.memberId===member.id)||null,votes:d.Votes.filter(v=>v.taskId===t.id)})),availability:d.Availability,assignments:d.Assignments,preview:plan_(d,week)};}
function publicMember_(m,settings){const saved=(settings||[]).find(x=>x.id==='avatar:'+m.id);return {id:m.id,name:m.name,active:m.active,admin:m.admin,hours:m.hours,skill:m.skill,avatar:saved&&AVATAR_IDS_.includes(saved.value)?saved.value:''};}
function consensus_(task,d){
  const members=d.Members.filter(m=>m.active),votes=members.map(m=>d.Votes.find(v=>v.taskId===task.id&&v.memberId===m.id)).filter(Boolean);
  const fingerprint=JSON.stringify(votes.map(v=>[v.memberId,v.priority,v.frequency,v.minutes,v.skill]).sort((a,b)=>a[0].localeCompare(b[0])));
  const allVoted=members.length>0&&votes.length===members.length,missing=members.filter(m=>!votes.some(v=>v.memberId===m.id)).map(m=>m.name);
  if(!votes.length)return {allVoted:false,ready:false,count:0,total:members.length,missing,flags:[],fingerprint};
  const med=values=>{values=values.slice().sort((a,b)=>a-b);return (Number(values[Math.floor((values.length-1)/2)])+Number(values[Math.floor(values.length/2)]))/2;};
  const mode=values=>{const counts={};values.forEach(v=>counts[v]=(counts[v]||0)+1);const max=Math.max(...Object.values(counts)),top=Object.keys(counts).filter(k=>counts[k]===max);return {value:top[0],tie:top.length>1};};
  const freq=mode(votes.map(v=>v.frequency)),skill=mode(votes.map(v=>String(v.skill))),minutes=med(votes.map(v=>Number(v.minutes))),priority=med(votes.map(v=>Number(v.priority))),flags=[];
  if(freq.tie||new Set(votes.map(v=>v.frequency)).size>1)flags.push('Frequency differs');
  if(skill.tie||new Set(votes.map(v=>v.skill)).size>1)flags.push('Expertise differs');
  if(Math.max(...votes.map(v=>v.priority))-Math.min(...votes.map(v=>v.priority))>=3)flags.push('Priority differs widely');
  if(Math.max(...votes.map(v=>v.minutes))/Math.min(...votes.map(v=>v.minutes))>=2)flags.push('Duration differs widely');
  const decision=d.Decisions.find(x=>x.taskId===task.id&&x.fingerprint===fingerprint),done=d.Assignments.filter(a=>a.taskId===task.id&&a.status==='done'&&Number(a.actual)>0);
  return Object.assign({allVoted,ready:allVoted&&(!flags.length||!!decision),count:votes.length,total:members.length,missing,flags,fingerprint,resolved:!!decision,priority,frequency:freq.value,minutes,skill:Number(skill.value),suggestedMinutes:done.length>=3?med(done.map(a=>Number(a.actual))):null},decision?{priority:decision.priority,frequency:decision.frequency,minutes:decision.minutes,skill:decision.skill}:{});
}
function plan_(d,week){
  const end=addDays_(week,6),members=d.Members.filter(m=>m.active),loads={},capacity={},issues=[],candidates=[],additions=[];
  members.forEach(m=>{capacity[m.id]=Math.round(hours_(m,week,d)*60*0.8);loads[m.id]=d.Assignments.filter(a=>a.memberId===m.id&&a.week===week&&a.status!=='cancelled').reduce((s,a)=>s+Number(a.minutes),0);});
  d.Tasks.filter(t=>!t.archived).forEach(t=>{
    const s=consensus_(t,d);if(!s.ready){issues.push({taskId:t.id,title:t.title,reason:s.allVoted?'Discuss ratings':'Awaiting '+s.missing.join(', '),minutes:0});return;}
    const history=d.Assignments.filter(a=>a.taskId===t.id&&a.status!=='cancelled');
    // Carry unfinished occurrences forward instead of creating duplicates.
    const overdue=history.filter(a=>a.status==='planned'&&a.week<week);
    if(overdue.length){overdue.forEach(a=>issues.push({taskId:t.id,title:t.title,reason:'Unfinished from '+a.week+' — complete or cancel it first',minutes:Number(a.minutes)}));return;}
    const interval=FREQ_[s.frequency],done=history.filter(a=>a.status==='done').sort((a,b)=>b.completed.localeCompare(a.completed));
    if(interval===0){if(history.length===0)candidates.push({t,s,due:week});return;}
    if(interval<=2){const offsets=interval===1?[0,1,2,3,4,5,6]:[0,2,4];offsets.forEach(offset=>{const due=addDays_(week,offset);if(!history.some(a=>a.due===due))candidates.push({t,s,due});});return;}
    if(history.some(a=>a.status==='planned'))return;
    const last=done[0],due=last?nextDate_(last.completed,s.frequency):week;
    if(due<=end)candidates.push({t,s,due:due<week?week:due});
  });
  candidates.sort((a,b)=>b.s.priority-a.s.priority||a.due.localeCompare(b.due)||a.t.id.localeCompare(b.t.id));
  candidates.forEach(c=>{
    const eligible=members.filter(m=>c.s.skill<3&&Number(m.skill)>=Number(c.s.skill)&&loads[m.id]+Number(c.s.minutes)<=capacity[m.id]);
    // Normalised load balances hours; historical task count breaks ties to rotate work.
    const count=m=>d.Assignments.concat(additions).filter(a=>a.taskId===c.t.id&&a.memberId===m.id&&a.status!=='cancelled').length;
    eligible.sort((a,b)=>(loads[a.id]/(capacity[a.id]||1)-loads[b.id]/(capacity[b.id]||1))||count(a)-count(b)||a.name.localeCompare(b.name));
    if(!eligible.length){issues.push({taskId:c.t.id,title:c.t.title,due:c.due,minutes:Number(c.s.minutes),reason:c.s.skill===3?'Professional required':members.some(m=>m.skill>=c.s.skill)?'Insufficient available hours':'No member has the required expertise'});return;}
    const m=eligible[0];loads[m.id]+=Number(c.s.minutes);additions.push({id:'occ:'+c.t.id+':'+c.due+':'+uid_(),taskId:c.t.id,memberId:m.id,week,due:c.due,minutes:Number(c.s.minutes),status:'planned',actual:'',completed:'',title:c.t.title});
  });
  return {additions,issues,loads,capacity};
}
function nextDate_(day,freq){if(freq==='Monthly'||freq==='Quarterly'||freq==='Annually'){const date=parseDate_(day),target=date.getUTCMonth()+(freq==='Monthly'?1:freq==='Quarterly'?3:12),dom=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(target);const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(dom,last));return date.toISOString().slice(0,10);}return addDays_(day,FREQ_[freq]);}
function hours_(member,week,d){const row=d.Availability.find(a=>a.memberId===member.id&&a.week===week);return row?Number(row.hours):Number(member.hours);}
function task_(id){const t=rows_('Tasks').find(t=>t.id===id&&!t.archived);if(!t)throw new Error('Task not found or archived.');return t;}
function admin_(member){if(!member.admin)throw new Error('Administrator access required.');}
function uid_(){return Utilities.getUuid().replace(/-/g,'');}
function hash_(value){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');}
function text_(s,max){s=String(s||'').trim();if(!s||s.length>max)throw new Error('Enter text between 1 and '+max+' characters.');return s;}
function number_(x,min,max){if(x===null||x===undefined||String(x).trim()===''||!Number.isFinite(Number(x))||Number(x)<min||Number(x)>max)throw new Error('Enter a number between '+min+' and '+max+'.');return Number(x);}
function today_(){return Utilities.formatDate(new Date(),'Australia/Sydney','yyyy-MM-dd');}
function parseDate_(day){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(day)))throw new Error('Select a valid date.');const d=new Date(day+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==day)throw new Error('Invalid date.');return d;}
function monday_(day){const d=parseDate_(day);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}
function addDays_(day,n){const d=parseDate_(day);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function locked_(fn){const lock=LockService.getScriptLock();lock.waitLock(30000);try{return fn();}finally{SpreadsheetApp.flush();lock.releaseLock();}}
function sheet_(name){const id=PropertiesService.getScriptProperties().getProperty('SHEET_ID');if(!id)throw new Error('Run setupHousehold in Apps Script first.');return SpreadsheetApp.openById(id).getSheetByName(name);}
function rows_(name){const sh=sheet_(name),n=sh.getLastRow();if(n<2)return [];return sh.getRange(2,1,n-1,TABLES_[name].length).getValues().map(row=>{const obj={};TABLES_[name].forEach((k,i)=>obj[k]=row[i] instanceof Date?Utilities.formatDate(row[i],'Australia/Sydney','yyyy-MM-dd'):row[i]);return obj;});}
function safeCell_(x){return typeof x==='string'&&/^[=+\-@]/.test(x)?"'"+x:x;}
function append_(name,obj){sheet_(name).appendRow(TABLES_[name].map(k=>safeCell_(obj[k]===undefined?'':obj[k])));}
function put_(name,obj){const sh=sheet_(name),rows=rows_(name),i=rows.findIndex(x=>x.id===obj.id);if(i<0)append_(name,obj);else sh.getRange(i+2,1,1,TABLES_[name].length).setValues([TABLES_[name].map(k=>safeCell_(obj[k]===undefined?'':obj[k]))]);}
function data_(){const d={};Object.keys(TABLES_).forEach(k=>d[k]=rows_(k));return d;}

function requireEditor_(){if(!SpreadsheetApp.getActiveSpreadsheet() || !Session.getActiveUser().getEmail() || Session.getActiveUser().getEmail()!==Session.getEffectiveUser().getEmail())throw new Error('Run this from the spreadsheet owner’s account in Apps Script.');}
function enableWeeklyPlanning(){requireEditor_();disableWeeklyPlanning();ScriptApp.newTrigger('weeklyPlan_').timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).inTimezone('Australia/Sydney').create();SpreadsheetApp.getUi().alert('Automatic planning enabled for Monday mornings, around 7–8 am Sydney time.');}
function disableWeeklyPlanning(){requireEditor_();ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='weeklyPlan_').forEach(t=>ScriptApp.deleteTrigger(t));}
function weeklyPlan_(){return locked_(()=>{const plan=plan_(data_(),monday_(today_()));plan.additions.forEach(a=>append_('Assignments',a));return plan.additions.length;});}

/* Hosted bridge: never place HOSTING_SECRET in a browser or in this file.
   Generate/retrieve it using showHostingConnection in the owner's editor. */
function showHostingConnection(){
  requireEditor_();
  const props=PropertiesService.getScriptProperties();
  if(!props.getProperty('SHEET_ID'))throw new Error('This project is not linked to a household Sheet yet. Use your existing bound project.');
  const secret=locked_(()=>{let value=props.getProperty('HOSTING_SECRET');if(!value){value=uid_()+uid_();props.setProperty('HOSTING_SECRET',value);}return value;});
  SpreadsheetApp.getUi().alert('Hosting connection secret','Copy this into the HOSTING_SECRET environment variable of your private hosting service:\n\n'+secret+'\n\nThis is separate from family access codes. Do not share it with family members or put it in public files. Re-running this function shows the same secret and preserves all family codes.',SpreadsheetApp.getUi().ButtonSet.OK);
}
function bridgeJson_(body){return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);}
function bridgeEqual_(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;let difference=0;for(let i=0;i<64;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
function doPost(e){
  try{
    if(!e||!e.postData||typeof e.postData.contents!=='string'||e.postData.contents.length>300000)throw new Error('BRIDGE_REQUEST');
    let envelope;try{envelope=JSON.parse(e.postData.contents);}catch(error){throw new Error('BRIDGE_REQUEST');}
    const secret=PropertiesService.getScriptProperties().getProperty('HOSTING_SECRET');
    if(!secret||!Number.isSafeInteger(envelope.timestamp)||Math.abs(Date.now()-envelope.timestamp)>300000||!/^[a-f0-9]{32}$/.test(envelope.nonce)||typeof envelope.payload!=='string'||typeof envelope.signature!=='string')throw new Error('BRIDGE_AUTH');
    const signingText='v1\n'+envelope.timestamp+'\n'+envelope.nonce+'\n'+envelope.payload;
    const expected=Utilities.computeHmacSha256Signature(signingText,secret,Utilities.Charset.UTF_8).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');
    if(!bridgeEqual_(envelope.signature,expected))throw new Error('BRIDGE_AUTH');
    locked_(()=>{const cache=CacheService.getScriptCache(),key='bridge-nonce:'+envelope.nonce;if(cache.get(key))throw new Error('BRIDGE_REPLAY');cache.put(key,'used',600);});
    let request;try{request=JSON.parse(envelope.payload);}catch(error){throw new Error('BRIDGE_REQUEST');}
    if(!request||typeof request!=='object'||Array.isArray(request))throw new Error('BRIDGE_REQUEST');
    if(request.action==='connection')return bridgeJson_({ok:true,result:{app:'Family Tasks',version:'hosted-2',spreadsheetReady:!!PropertiesService.getScriptProperties().getProperty('SHEET_ID')}});
    try{return bridgeJson_({ok:true,result:api_(request)});}
    catch(error){
      const message=String(error.message||'Could not complete this action.');
      const code=/Please sign in|Session expired|Access has changed/.test(message)?'AUTH_REQUIRED':/Name or access code is incorrect/.test(message)?'LOGIN_FAILED':/Too many attempts/.test(message)?'RATE_LIMITED':/Run setupHousehold|SHEET_ID|not linked/.test(message)?'SETUP_REQUIRED':'USER_ERROR';
      return bridgeJson_({ok:false,error:{code,message}});
    }
  }catch(error){return bridgeJson_({ok:false,error:{code:'BRIDGE_ERROR',message:'The hosting connection could not be verified.'}});}
}
