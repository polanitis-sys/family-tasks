import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createBridge, BridgeError} from './lib/bridge.mjs';

const publicDir = new URL('./public/', import.meta.url);
const assets = new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/index.html', ['index.html','text/html; charset=utf-8']],
  ['/styles.css', ['styles.css','text/css; charset=utf-8']],
  ['/app.js', ['app.js','text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg','image/svg+xml']]
]);
const actions = new Set(['login','logout','state','vote','addTasks','profile','availability','addMember','memberAccess','resolve','plan','assignment','archive']);
const cookieName = 'family_session';
const sessionPattern = /^[a-f0-9]{64}$/;
const errorBody = (code,message) => ({ok:false,error:{code,message}});
function json(res,status,body) {res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));}
function setSession(res,token,secure) {
  res.setHeader('Set-Cookie',`${cookieName}=${token || ''}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 21600 : 0}${secure ? '; Secure' : ''}`);
}
function getSession(req) {
  const pairs=String(req.headers.cookie || '').split(';').map(x=>x.trim());
  const match=pairs.find(x=>x.startsWith(cookieName+'='));
  const token=match ? match.slice(cookieName.length+1) : '';
  return sessionPattern.test(token) ? token : '';
}
function securityHeaders(res,secure) {
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; frame-src 'none'");
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control','no-store');
  if(secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
}
async function readJson(req) {
  let bytes=0;const chunks=[];
  for await (const chunk of req) {bytes+=chunk.length;if(bytes>131072){const e=new Error('Use a smaller task import (maximum request size: 128 KB).');e.status=413;throw e;}chunks.push(chunk);}
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const e=new Error('Send a valid JSON request.');e.status=400;throw e;}
}
export function createApp({origin,bridge,secure=true}) {
  const url=new URL(origin);
  if(url.origin!==origin || (secure && url.protocol!=='https:'))throw new Error('Set PUBLIC_ORIGIN to the exact HTTPS origin of your hosted website, with no trailing slash.');
  if(typeof bridge!=='function')throw new Error('A spreadsheet connection is required.');
  const buckets=new Map();
  function rateAllowed(address) {
    const now=Date.now();
    if(buckets.size>10000)for(const [key,b] of buckets)if(b.until<=now)buckets.delete(key);
    let b=buckets.get(address);if(!b||b.until<=now){b={count:0,until:now+600000};buckets.set(address,b);}
    b.count++;return b.count<=600;
  }
  return http.createServer(async (req,res)=>{
    securityHeaders(res,secure);
    try {
      const path=new URL(req.url,'http://localhost').pathname;
      if(path==='/healthz'&&(req.method==='GET'||req.method==='HEAD')){json(res,200,{ok:true});return;}
      if(path==='/api'){
        if(req.method!=='POST'){res.setHeader('Allow','POST');json(res,405,errorBody('METHOD_NOT_ALLOWED','Use POST.'));return;}
        if(req.headers.origin!==origin||req.headers['x-family-request']!=='1'||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')||req.headers['sec-fetch-site']==='cross-site'){
          json(res,403,errorBody('ORIGIN_REJECTED','Open the family website directly and try again.'));return;
        }
        if(!rateAllowed(req.socket.remoteAddress||'unknown')){res.setHeader('Retry-After','600');json(res,429,errorBody('RATE_LIMITED','There have been too many requests. Please try again later.'));return;}
        const input=await readJson(req);
        if(!input||typeof input!=='object'||Array.isArray(input)||!actions.has(input.action)){json(res,400,errorBody('INVALID_ACTION','Choose a valid app action.'));return;}
        const action=input.action,token=getSession(req);
        if(action==='logout'){
          setSession(res,'',secure);
          if(token){try{await bridge({action,token});}catch{/* Always clear the browser session even if the bridge is unavailable. */}}
          json(res,200,{ok:true,result:{ok:true}});return;
        }
        if(action!=='login'&&!token){json(res,401,errorBody('AUTH_REQUIRED','Please sign in.'));return;}
        let request;
        if(action==='login'){
          if(typeof input.name!=='string'||input.name.length>60||typeof input.key!=='string'||input.key.length>128){json(res,400,errorBody('INVALID_LOGIN','Enter your family name and access code.'));return;}
          request={action,name:input.name,key:input.key};
        }else{
          if(input.data!==undefined&&(!input.data||typeof input.data!=='object'||Array.isArray(input.data))){json(res,400,errorBody('INVALID_DATA','Enter valid form details.'));return;}
          request={action,token,data:input.data||{}};
        }
        const result=await bridge(request);
        if(!result.ok){
          const {code}=result.error;
          if(code==='BRIDGE_ERROR'||code==='SETUP_REQUIRED'){json(res,502,errorBody('CONNECTION_REQUIRED','The spreadsheet connection needs attention. Ask the household administrator to run the connection check.'));return;}
          if(code==='AUTH_REQUIRED')setSession(res,'',secure);
          const status=['AUTH_REQUIRED','LOGIN_FAILED'].includes(code)?401:code==='RATE_LIMITED'?429:400;
          json(res,status,result);return;
        }
        if(action==='login'){
          if(!sessionPattern.test(result.result?.token||''))throw new BridgeError('The spreadsheet returned an invalid login session.');
          setSession(res,result.result.token,secure);
          json(res,200,{ok:true,result:{signedIn:true}});return;
        }
        json(res,200,result);return;
      }
      if(req.method!=='GET'&&req.method!=='HEAD'){json(res,405,errorBody('METHOD_NOT_ALLOWED','This action is not supported.'));return;}
      const asset=assets.get(path);
      if(!asset){json(res,404,errorBody('NOT_FOUND','Page not found.'));return;}
      const bytes=await readFile(new URL(asset[0],publicDir));
      res.writeHead(200,{'Content-Type':asset[1],'Content-Length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);
    }catch(error){
      if(res.headersSent){res.end();return;}
      if(error instanceof BridgeError){json(res,error.code==='UPSTREAM_TIMEOUT'?504:502,errorBody(error.code,error.message));return;}
      if(error.status){json(res,error.status,errorBody('INVALID_REQUEST',error.message));return;}
      // Do not log request bodies, family codes, cookies, bridge URLs or secrets.
      json(res,500,errorBody('SERVER_ERROR','The app could not complete this action. Please try again.'));
    }
  });
}
export function configFromEnv(env=process.env) {
  const port=Number(env.PORT||3000),secure=env.NODE_ENV!=='development';
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be an available port number.');
  const origin=env.PUBLIC_ORIGIN||env.RENDER_EXTERNAL_URL||(!secure?`http://localhost:${port}`:'');
  if(!origin)throw new Error('Set PUBLIC_ORIGIN to your website origin (or deploy on Render, which supplies RENDER_EXTERNAL_URL).');
  return {port,origin,secure,backendUrl:env.APPS_SCRIPT_URL,secret:env.HOSTING_SECRET};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const config=configFromEnv(),bridge=createBridge(config),server=createApp({...config,bridge});
    server.requestTimeout=100000;server.headersTimeout=15000;
    server.listen(config.port,'0.0.0.0',()=>console.log('Family Tasks is ready.'));
    process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
