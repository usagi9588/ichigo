import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureResponse} from './fixtures.ts';
test('test-only site supports job text, login, cross-origin popup, submission and failures',()=>{
  const job=fixtureResponse('/jobs/engineer');assert.equal(job.status,200);assert.match(job.body,/data-company/);assert.match(job.body,/target="_blank"/);
  assert.match(fixtureResponse('/jobs/private').body,/Please sign in first/);
  assert.match(fixtureResponse('/jobs/private','GET','test-login=1').body,/About the role/);
  assert.equal(fixtureResponse('/login','POST').status,303);
  assert.equal(fixtureResponse('/redirect').headers.location,'http://127.0.0.1:4186/apply');
  assert.equal(fixtureResponse('/fail').status,503);
  assert.match(fixtureResponse('/apply','POST').body,/Mock application submitted/);
  assert.equal(fixtureResponse('/missing').status,404);
});
