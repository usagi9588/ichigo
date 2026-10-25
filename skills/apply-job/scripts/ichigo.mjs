#!/usr/bin/env node
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, mkdirSync, openSync, closeSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export const root = process.env.ICHIGO_ROOT ? resolve(process.env.ICHIGO_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const port = Number(process.env.ICHIGO_PORT ?? 4174);
const base = `http://127.0.0.1:${port}`;
const projectId = createHash('sha256').update(root).digest('hex').slice(0,16);
const directory = process.env.ICHIGO_DATA_DIR ? resolve(process.env.ICHIGO_DATA_DIR) : join(root,'.data');
export const help = `Ichigo CLI (Node.js 24+)
  status | serve | stop | list | get ID
  start URL_OR_ID
  patch ID --json '{"company":"Acme","title":"AI Engineer"}'
  pages ID --session SESSION_ID --json '{"pages":[{"url":"https://...","title":"...","marker":"ichigo:SESSION_ID"}]}'
  result ID --session SESSION_ID --result applied|pending|saved [--at ISO_TIME]
  screenshot ID --file /absolute/path/full-page.png
  screenshot ID --file /absolute/path/job.pdf
  screenshot ID --status blocked|failed|missing [--error REASON]
JSON may be read from a file using --json @/absolute/path/data.json.
Environment: ICHIGO_PORT (4174), ICHIGO_DATA_DIR, ICHIGO_ROOT.
`;
export function parse(argv) {
  const [command = 'help', value, ...rest] = argv;
  const flags = {};
  for (let i=0;i<rest.length;i+=2) {
    if (!rest[i]?.startsWith('--') || rest[i+1] === undefined) throw new Error('Arguments must use --name value');
    flags[rest[i].slice(2)] = rest[i+1];
  }
  const allowed = { patch:['json'],pages:['session','json'],result:['session','result','at'],screenshot:['file','status','error'] };
  for(const name of Object.keys(flags)) if (!allowed[command]?.includes(name)) throw new Error(`Unsupported option --${name}`);
  return {command,value,flags};
}
export async function health(fetcher = fetch) {
  try {
    const response = await fetcher(base+'/api/health',{signal:AbortSignal.timeout(1000)});
    const h = await response.json();
    if (!response.ok || h.service !== 'ichigo' || h.projectId !== projectId) throw new Error('Port is in use by another service or Ichigo project');
    return h;
  } catch(e) { if(e.message?.includes('in use')) throw e; return null; }
}
async function ensure() {
  if (!Number.isInteger(port) || port<1024 || port>65535) throw new Error('Invalid ICHIGO_PORT');
  const h=await health(); if(h) return h;
  mkdirSync(directory,{recursive:true});
  const fd=openSync(join(directory,'server.log'),'a');
  const child=spawn(process.execPath,[join(root,'src/server.ts')],{cwd:root,env:{...process.env,ICHIGO_DATA_DIR:directory},detached:true,stdio:['ignore',fd,fd]});
  closeSync(fd); let spawnError; child.on('error',e=>{spawnError=e;}); child.unref();
  for(let i=0;i<20;i++) {
    if(spawnError) throw spawnError;
    await new Promise(r=>setTimeout(r,150));
    const ready=await health(); if(ready) return ready;
  }
  throw new Error(`Local service failed to start. Check ${join(directory,'server.log')}; or run npm start from the project directory.`);
}
function readJson(value) {
  if(!value) throw new Error('Missing --json');
  const result=JSON.parse(value.startsWith('@')?readFileSync(value.slice(1),'utf8'):value);
  if(!result || typeof result!=='object' || Array.isArray(result)) throw new Error('JSON must be an object');
  return result;
}
export async function execute(argv, request) {
  const {command,value,flags}=parse(argv);
  const id=() => {if(!/^[1-9]\d*$/.test(value??'') || !Number.isSafeInteger(Number(value))) throw new Error('Provide a valid job ID');return value;};
  const session=()=>{if(!flags.session) throw new Error('Missing --session. Look up the job application session first');return flags.session;};
  if(command==='help' || command==='--help') return {help};
  if(command==='list') return request('GET','/api/jobs');
  if(command==='get') return request('GET',`/api/jobs/${id()}`);
  if(command==='start') {
    if(!value) throw new Error('Provide a job URL or ID');
    let job;
    if(/^[1-9]\d*$/.test(value)) job=(await request('GET',`/api/jobs/${id()}`)).job;
    else {
      const u=new URL(value);if(!['http:','https:'].includes(u.protocol)) throw new Error('Job URL must use http or https');
      job=(await request('POST','/api/jobs',{url:value})).job;
    }
    return request('POST',`/api/jobs/${job.id}/start`,{});
  }
  if(command==='patch') return request('PATCH',`/api/jobs/${id()}`,readJson(flags.json));
  if(command==='pages') return request('POST',`/api/jobs/${id()}/pages`,{...readJson(flags.json),sessionId:session()});
  if(command==='result') {
    if(!['applied','pending','saved'].includes(flags.result)) throw new Error('Result must be applied, pending, or saved');
    return request('POST',`/api/jobs/${id()}/result`,{sessionId:session(),result:flags.result,...(flags.at?{appliedAt:flags.at}:{})});
  }
  if(command==='screenshot') {
    let data;
    if(flags.file) {
      if(flags.status || flags.error) throw new Error('--file cannot be combined with --status or --error');
      if(statSync(flags.file).size>12*1024*1024) throw new Error('Capture exceeds 12 MB');
      const bytes=readFileSync(flags.file);
      const pdf=/^%PDF-\d\.\d/.test(bytes.subarray(0,8).toString('ascii'));
      data=pdf?{pdfBase64:bytes.toString('base64')}:{pngBase64:bytes.toString('base64')};
    } else {
      if(!['blocked','failed','missing'].includes(flags.status)) throw new Error('Provide --file or a valid --status');
      data={status:flags.status,error:flags.error??''};
    }
    return request('POST',`/api/jobs/${id()}/screenshot`,data);
  }
  throw new Error('Unknown command. Run help to see usage');
}
async function main() {
  const argv=process.argv.slice(2); const {command}=parse(argv);
  if(command==='help'||command==='--help') {console.log(help);return;}
  if(command==='status') {console.log(JSON.stringify(await health()??{service:'ichigo',running:false,baseUrl:base}));return;}
  if(command==='stop') {
    const h=await health();
    if(h) {
      if(!Number.isSafeInteger(h.pid)||h.pid<2) throw new Error('Invalid service process ID');
      process.kill(h.pid,'SIGTERM');
    }
    console.log(JSON.stringify({stopped:!!h})); return;
  }
  if(command==='serve') {console.log(JSON.stringify(await ensure()));return;}
  // Validate before starting a background service.
  let firstRequest=true;
  const request=async(method,path,body)=>{
    if(firstRequest) {await ensure();firstRequest=false;}
    const response=await fetch(base+path,{method,headers:{'content-type':'application/json','x-ichigo-client':'cli'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
    const result=await response.json();
    if(!response.ok) throw new Error(result.error??`HTTP ${response.status}`);
    return result;
  };
  console.log(JSON.stringify(await execute(argv,request)));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) main().catch(error=>{console.error(JSON.stringify({error:error.message}));process.exitCode=1;});
