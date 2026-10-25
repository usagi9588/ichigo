import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeApp } from '../src/server.ts';
import { Store } from '../src/store.ts';

function setup(t: {after: (fn: () => void) => void}) {
  const directory = mkdtempSync(join(tmpdir(),'ichigo-test-'));
  const app = makeApp({directory});
  t.after(() => {app.store.close();rmSync(directory,{recursive:true,force:true});});
  const headers = {'host':'127.0.0.1:4174','content-type':'application/json','x-ichigo-client':'cli'};
  function request(method: string, path: string, body: Record<string,unknown> = {}, extra = {}) {
    const r = app.dispatch(method,path,{...headers,...extra},body);
    return { status:r.status, data:JSON.parse(r.body.toString()) };
  }
  return {...app,request,directory};
}
test('schema migrates once, fields/history persist across reopening',t => {
  const {store,directory} = setup(t);
  const j = store.create({url:'https://jobs.example/1',company:'Acme',title:'AI',notes:'Notes',text:'Job description',mode:'Remote',salary:'100',tag:'ML',actualUrl:'https://ats.example/1'}).job;
  store.patch(j.id,{notes:'Updated',stage:'interview'});
  const second = new Store(directory);
  try {const saved = second.get(j.id);assert.equal(saved.notes,'Updated');assert.equal(saved.stage,'interview');assert.equal(saved.text,'Job description');assert.equal(saved.history.length,2);} finally {second.close();}
});
test('complete API lifecycle, duplicate links, idempotent results, repeat application', t => {
  const {request:r} = setup(t);
  const created = r('POST','/api/jobs',{url:'https://jobs.example/1#top',company:'A'});
  assert.equal(created.status,201); const id=created.data.job.id;
  assert.equal(r('POST','/api/jobs',{url:'https://jobs.example/1'}).data.job.id,id);
  assert.equal(r('GET','/api/jobs').data.jobs.length,1);
  let session = r('POST',`/api/jobs/${id}/start`).data.session;
  assert.equal(r('POST',`/api/jobs/${id}/start`).data.session.id,session.id);
  assert.equal(r('PATCH',`/api/jobs/${id}`,{stage:'applied'}).status,409);
  assert.equal(r('POST',`/api/jobs/${id}/pages`,{sessionId:session.id,pages:[{url:'https://jobs.example/1',marker:'ichigo:'+session.id}]}).status,200);
  const payload = {sessionId:session.id,result:'applied',appliedAt:'2026-10-22T10:00:00Z'};
  assert.equal(r('POST',`/api/jobs/${id}/result`,payload).data.job.stage,'applied');
  const count=r('GET',`/api/jobs/${id}`).data.job.history.length;
  assert.equal(r('POST',`/api/jobs/${id}/result`,payload).status,200);
  assert.equal(r('GET',`/api/jobs/${id}`).data.job.history.length,count);
  assert.equal(r('POST',`/api/jobs/${id}/result`,{...payload,result:'saved'}).status,409);
  session=r('POST',`/api/jobs/${id}/start`).data.session;
  assert.equal(r('POST',`/api/jobs/${id}/result`,{sessionId:session.id,result:'pending'}).data.job.stage,'pending');
  session=r('POST',`/api/jobs/${id}/start`).data.session;
  assert.equal(r('POST',`/api/jobs/${id}/result`,{sessionId:session.id,result:'saved'}).data.job.stage,'saved');
  assert.equal(r('GET',`/api/jobs/${id}`).data.job.sessions.length,3);
});
test('one active job, invalid fields, URL collision and transaction rollback',t=>{
  const {store,request:r}=setup(t);
  assert.equal(r('POST','/api/jobs',{url:'javascript:alert(1)'}).status,400);
  assert.equal(r('POST','/api/jobs',{url:'https://example.test/bad',stage:'bogus'}).status,400);
  assert.equal(store.list().length,0);
  const a=store.create({url:'https://example.test/a'}).job;
  const b=store.create({url:'https://example.test/b'}).job;
  store.start(a.id);
  assert.equal(r('POST',`/api/jobs/${b.id}/start`).status,409);
  assert.equal(r('PATCH',`/api/jobs/${b.id}`,{url:a.url}).status,409);
  assert.equal(r('POST',`/api/jobs/${a.id}/result`,{sessionId:'wrong',result:'applied'}).status,404);
  assert.equal(r('PATCH',`/api/jobs/${b.id}`,{appliedAt:'bad'}).status,400);
  assert.equal(r('GET','/api/jobs/9999').status,404);
});
test('legacy import skips demo jobs, repeats safely, preserves errors for recovery', t=>{
  const {request:r}=setup(t);
  const jobs=[{id:1,url:'https://demo.test'},{id:1000,url:'https://real.test/1',title:'Real',notes:'Keep',stage:'applying',history:[{text:'Previous activity',time:'2026-10-22T12:00:00Z'}]},{id:1001,url:'invalid'}];
  const first=r('POST','/api/import',{jobs}).data;
  assert.equal(first.imported,1); assert.equal(first.skipped,1);assert.equal(first.errors.length,1);
  assert.equal(r('GET','/api/jobs').data.jobs[0].stage,'pending');
  assert.ok(r('GET','/api/jobs').data.jobs[0].history.some((e:{text:string})=>e.text==='Previous activity'));
  assert.equal(r('POST','/api/import',{jobs}).data.imported,0);
  assert.equal(r('GET','/api/jobs').data.jobs.length,1);
});
test('screenshots saved as PNG, retrievable, failures preserve previous capture, traversal blocked',t=>{
  const {store,request:r,dispatch}=setup(t);
  const id=store.create({url:'https://example.test'}).job.id;
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
  const capture=r('POST',`/api/jobs/${id}/screenshot`,{pngBase64:png});
  assert.equal(capture.status,200);
  const path=capture.data.job.screenshot;
  assert.equal(dispatch('GET',path).status,200);
  assert.equal(r('POST',`/api/jobs/${id}/screenshot`,{status:'blocked',error:'Sign-in required'}).data.job.screenshot,path);
  assert.equal(r('POST',`/api/jobs/${id}/screenshot`,{pngBase64:'not png'}).status,400);
  for(const p of ['/src/store.ts','/.data/ichigo.sqlite','/screenshots/../ichigo.sqlite','/package.json']) assert.equal(dispatch('GET',p).status,404);
});
test('same-origin writes only, reject hostile Host/Origin/form and cross-site fetch', t=>{
  const {request:r,dispatch}=setup(t);
  assert.equal(r('GET','/api/health').data.service,'ichigo');
  assert.equal(r('GET','/api/jobs',{}, {host:'attacker.test:4174'}).status,403);
  assert.equal(r('POST','/api/jobs',{url:'https://x.test'}, {origin:'https://attacker.test'}).status,403);
  assert.equal(r('POST','/api/jobs',{url:'https://x.test'}, {'content-type':'text/plain'}).status,415);
  assert.equal(r('POST','/api/jobs',{url:'https://x.test'}, {'sec-fetch-site':'cross-site'}).status,403);
  assert.equal(dispatch('POST','/api/jobs',{'content-type':'application/json'},{url:'https://x.test'}).status,403);
  assert.equal(r('POST','/api/jobs',{url:'https://x.test'}, {origin:'http://localhost:4174'}).status,201);
  assert.equal(dispatch('GET','/').headers['content-type'],'text/html; charset=utf-8');
});

test('PDF import, serving, validation and failed recapture preserve stored files and stage',t=>{
  const {store,request:r,dispatch,directory}=setup(t);
  const id=store.create({url:'https://example.test/pdf',stage:'interview'}).job.id;
  const endpoint=`/api/jobs/${id}/screenshot`;
  const pdf=Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
  const captured=r('POST',endpoint,{pdfBase64:pdf.toString('base64')});
  assert.equal(captured.status,200);
  const job=captured.data.job,path=job.screenshot;
  assert.match(path,/\.pdf$/);assert.equal(job.stage,'interview');assert.equal(job.sessions.length,0);
  assert.equal(job.history.at(-1).text,'Saved job PDF');
  const served=dispatch('GET',path);
  assert.equal(served.headers['content-type'],'application/pdf');assert.deepEqual(served.body,pdf);
  assert.equal(served.headers['x-content-type-options'],'nosniff');
  for(const payload of [{pdfBase64:'invalid!'},{pdfBase64:Buffer.from('not a PDF').toString('base64')},
    {pngBase64:pdf.toString('base64')},{pdfBase64:pdf.toString('base64'),pngBase64:'AAAA'},
    {pdfBase64:Buffer.concat([pdf,Buffer.alloc(12*1024*1024)]).toString('base64')}]) {
    assert.equal(r('POST',endpoint,payload).status,400);
    assert.equal(store.get(id).screenshot,path);
  }
  const failed=r('POST',endpoint,{status:'failed',error:'PNG and PDF capture failed'}).data.job;
  assert.equal(failed.screenshot,path);assert.equal(failed.screenshotStatus,'failed');
  assert.equal(failed.screenshotError,'PNG and PDF capture failed');assert.equal(dispatch('GET',path).status,200);
  const reopened=new Store(directory);
  try {assert.equal(reopened.get(id).screenshot,path);} finally {reopened.close();}
  for(const path of ['/screenshots/../../ichigo.sqlite','/screenshots/file.pdf','/screenshots/1-00000000-0000-0000-0000-000000000000.html']) assert.equal(dispatch('GET',path).status,404);
});

test('new jobs honor the chosen board stage without creating implicit active sessions', t=>{
  const {request:r}=setup(t);
  const created=r('POST','/api/jobs',{url:'https://example.test/interview',stage:'interview'});
  assert.equal(created.status,201);assert.equal(created.data.job.stage,'interview');assert.equal(created.data.job.sessions.length,0);
  assert.equal(r('POST','/api/jobs',{url:'https://example.test/implicit',stage:'applying'}).status,409);
});
