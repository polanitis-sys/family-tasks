import vm from 'node:vm';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
export function createBackend() {
  const sheets={},cache=new Map(),props=new Map(),tickets=new Map(),dialogs=[];
  let ownerKey='',hostingSecret='';
  class Sheet {
    constructor(){this.data=[];}
    appendRow(row){this.data.push(row.map(v=>typeof v==='string'&&v.startsWith("'")?v.slice(1):v));}
    getLastRow(){return this.data.length;}
    getRange(r,c,n,m){return {getValues:()=>this.data.slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+m)),setValues:values=>{values.forEach((row,i)=>this.data[r-1+i]=row.map(v=>typeof v==='string'&&v.startsWith("'")?v.slice(1):v));},setBackground(){return this;},setFontColor(){return this;},setFontWeight(){return this;}};}
    setFrozenRows(){}autoResizeColumns(){}
  }
  const ss={setSpreadsheetTimeZone(){},getId:()=> 'test-sheet',getSheetByName:n=>sheets[n],insertSheet:n=>sheets[n]=new Sheet()};
  const ctx=vm.createContext({Date,Set,Map,JSON,Math,Number,String,Object,Array,Error,
    Session:{getActiveUser:()=>({getEmail:()=> 'parent@example.com'}),getEffectiveUser:()=>({getEmail:()=> 'parent@example.com'})},
    SpreadsheetApp:{getActiveSpreadsheet:()=>ss,openById:()=>ss,flush(){},getUi:()=>({ButtonSet:{OK:1},alert:(title,msg)=>{dialogs.push({title,msg});if(title==='Administrator access')ownerKey=msg.match(/Access code: (\w+)/)[1];if(title==='Hosting connection secret')hostingSecret=msg.match(/\n\n([a-f0-9]{64})\n/)[1];}})},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)})},
    Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(alg,value)=>Array.from(crypto.createHash('sha256').update(value).digest()),computeHmacSha256Signature:(value,key)=>Array.from(crypto.createHmac('sha256',key).update(value).digest()),formatDate:d=>d.toISOString().slice(0,10)},
    CacheService:{getScriptCache:()=>({get:k=>{const v=cache.get(k);return v&&v.until>Date.now()?v.value:null;},put:(k,value,ttl)=>cache.set(k,{value,until:Date.now()+ttl*1000}),remove:k=>cache.delete(k)})},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    ContentService:{MimeType:{JSON:'application/json'},createTextOutput:text=>({setMimeType(){return this;},getContent:()=>text})}
  });
  vm.runInContext(readFileSync(new URL('../google-apps-script/Code.gs',import.meta.url),'utf8'),ctx);
  ctx.setupHousehold();
  const initialCodes=sheets.Members.data.map(row=>row[2]);ctx.showHostingConnection();
  if(JSON.stringify(initialCodes)!==JSON.stringify(sheets.Members.data.map(row=>row[2])))throw new Error('Hosting configuration changed family credentials.');
  const api=request=>JSON.parse(JSON.stringify(ctx.api_(request)));
  const direct=envelope=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(envelope)}}).getContent());
  const fetchImpl=async (url,options)=>{
    if(options.method==='POST'){
      const result=direct(JSON.parse(options.body)),ticket=crypto.randomUUID();tickets.set(ticket,result);
      return new Response(null,{status:302,headers:{location:'https://script.googleusercontent.com/macros/echo?ticket='+ticket}});
    }
    const ticket=new URL(url).searchParams.get('ticket'),result=tickets.get(ticket);tickets.delete(ticket);
    return new Response(JSON.stringify(result),{status:result?200:404,headers:{'Content-Type':'application/json'}});
  };
  return {ctx,sheets,props,dialogs,ownerKey,secret:hostingSecret,api,direct,fetchImpl};
}
