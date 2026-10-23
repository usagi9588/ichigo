// Run from a normal local terminal: npm run e2e:serve.
// Creates isolated test databases and real HTTP fixture servers; never mounts test routes in production.
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {fixtureResponse} from '../tests/fixtures.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
const dataRoot=join(root,'.data');mkdirSync(dataRoot,{recursive:true});
const directory=mkdtempSync(join(dataRoot,'e2e-'));
const basePort=Number(process.env.ICHIGO_E2E_PORT??4184);
if(!Number.isInteger(basePort)||basePort<1024||basePort>65533)throw new Error('ICHIGO_E2E_PORT must be between 1024 and 65533');
const appBase=`http://127.0.0.1:${basePort}`,jobsBase=`http://127.0.0.1:${basePort+1}`;
const cliPath=join(root,'skills/apply-job/scripts/ichigo.mjs');
const env={...process.env,ICHIGO_ROOT:root,ICHIGO_DATA_DIR:directory,ICHIGO_PORT:String(basePort)};
const execute=promisify(execFile);
const cli=async(...args)=>JSON.parse((await execute(process.execPath,[cliPath,...args],{env,cwd:root,timeout:15000})).stdout);
const servers=[];let backendStarted=false,cleaning=false;
async function cleanup(){
  if(cleaning)return;cleaning=true;
  if(backendStarted)try{await cli('stop');}catch(e){console.error('Failed to stop test backend: '+e.message);}
  await Promise.all(servers.map(server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})));
}
async function main(){
  // Refuse to reuse any service: every test run must use its own database.
  const existing=await cli('status');if(existing.running!==false)throw new Error('An existing service is using the integration test port. Set a different ICHIGO_E2E_PORT');
  for(const port of [basePort+1,basePort+2]){
    const server=createServer((req,res)=>{const result=fixtureResponse(req.url??'/',req.method,req.headers.cookie??'',basePort+2);res.writeHead(result.status,result.headers);res.end(result.body);});
    servers.push(server);
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  }
  await cli('serve');backendStarted=true;
  const checks=[];
  for(const result of ['applied','pending','saved']){
    const started=await cli('start',`${jobsBase}/jobs/cli-${result}`);
    const id=String(started.job.id),session=started.session.id;
    await cli('patch',id,'--json',JSON.stringify({company:'CLI Test',title:result,notes:'persist after restart'}));
    await cli('pages',id,'--session',session,'--json',JSON.stringify({pages:[{url:`${jobsBase}/jobs/cli-${result}`,marker:'ichigo:'+session}]}));
    await cli('screenshot',id,'--status','blocked','--error','CLI fixture screenshot smoke test');
    const png=join(directory,'cli-smoke.png');
    writeFileSync(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64'));
    await cli('screenshot',id,'--file',png);
    const finished=await cli('result',id,'--session',session,'--result',result);
    assert.equal(finished.job.stage,result);assert.equal(finished.job.screenshotStatus,'ready');
    const repeated=await cli('result',id,'--session',session,'--result',result);
    assert.equal(repeated.job.history.length,finished.job.history.length);
    checks.push('CLI real HTTP: '+result);
  }
  const before=await cli('list');await cli('stop');
  for(let i=0;i<30;i++){if((await cli('status')).running===false)break;await new Promise(r=>setTimeout(r,100));}
  // list must autostart the background server and recover the same SQLite data.
  const after=await cli('list');assert.deepEqual(after,before);checks.push('CLI restart and SQLite persistence');
  const config={appBase,jobsBase,alternateBase:`http://127.0.0.1:${basePort+2}`,directory,cliChecks:checks};
  writeFileSync(join(dataRoot,'e2e-config.json'),JSON.stringify(config,null,2));
  writeFileSync(join(directory,'cli-report.json'),JSON.stringify({passed:true,checks},null,2));
  console.log('\n🍓 Integration environment is running. Keep this terminal open:\n'+JSON.stringify(config,null,2));
  console.log('Press Ctrl+C to stop all test services. The test database is retained for inspection. Production .data/ichigo.sqlite is unaffected.');
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>cleanup().then(()=>process.exit(0)));
main().catch(async error=>{console.error(error);await cleanup();process.exitCode=1;});
