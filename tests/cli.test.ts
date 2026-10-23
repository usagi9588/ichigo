import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeApp} from '../src/server.ts';
// @ts-ignore Native Node executes the project-local JavaScript CLI.
import {execute, root as cliRoot} from '../skills/apply-job/scripts/ichigo.mjs';

test('CLI drives start, metadata, page tracking, screenshot and result through actual handlers',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'ichigo-cli-'));
  const app=makeApp({directory});t.after(()=>{app.store.close();rmSync(directory,{recursive:true,force:true});});
  const request=async(method:string,path:string,body={})=>{
    const r=app.dispatch(method,path,{'content-type':'application/json','x-ichigo-client':'cli'},body);
    const data=JSON.parse(r.body.toString());if(r.status>=400)throw new Error(data.error);return data;
  };
  const started=await execute(['start','https://jobs.example/1'],request);
  const id=String(started.job.id),session=started.session.id;
  assert.match(started.job.detailUrl,/#job\//);
  await execute(['patch',id,'--json','{"company":"Acme","title":"Engineer","text":"Description"}'],request);
  await execute(['pages',id,'--session',session,'--json','{"pages":[{"url":"https://jobs.example/1","marker":"ichigo:test"}]}'],request);
  await execute(['screenshot',id,'--status','blocked','--error','Login'],request);
  const path=join(directory,'capture.png');writeFileSync(path,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64'));
  await execute(['screenshot',id,'--file',path],request);
  const result=await execute(['result',id,'--session',session,'--result','applied'],request);
  assert.equal(result.job.stage,'applied');assert.equal(result.job.screenshotStatus,'ready');
  assert.equal(result.job.sessions[0].pages.length,1);
  assert.equal((await execute(['list'],request)).jobs.length,1);
  assert.equal((await execute(['get',id],request)).job.company,'Acme');
});
test('invalid CLI arguments fail before any request, API failure never reports success',async()=>{
  let calls=0;const request=async()=>{calls++;throw new Error('Database unavailable');};
  for(const argv of [['start','javascript:bad'],['result','1','--result','yes'],['get','bad'],['patch','1','--json','[]'],['pages','1','--json','{}'],['unknown']]) {
    await assert.rejects(execute(argv,request));
  }
  assert.equal(calls,0);
  await assert.rejects(execute(['result','1','--session','s','--result','applied'],request),/Database unavailable/);
});

test('CLI resolves the project root correctly without an ICHIGO_ROOT override',()=>{assert.equal(cliRoot,process.env.ICHIGO_ROOT?resolve(process.env.ICHIGO_ROOT):resolve(fileURLToPath(new URL('../',import.meta.url))));});
