// Real HTTP + SQLite + visible browser integration. Run through Playwright MCP.
// Only local fixture forms are submitted. No route mocks and no real applications.
export async function run(page, config) {
  const {appBase,jobsBase,alternateBase}=config;
  const context=page.context(),checks=[],createdPages=[],jobIds=[];
  const runId=String(Date.now());
  const check=(value,label)=>{if(!value)throw new Error(label);checks.push(label);};
  async function api(method,path,data){
    const response=await context.request.fetch(appBase+'/api'+path,{method,data,headers:{origin:appBase,'content-type':'application/json'},timeout:10000});
    const result=await response.json();
    if(!response.ok())throw new Error(`HTTP ${response.status()}: ${result.error}`);
    return result;
  }
  async function newPage(url){const p=await context.newPage();createdPages.push(p);p.setDefaultTimeout(10000);await p.goto(url);return p;}
  async function begin(path){
    const {job}=await api('POST','/jobs',{url:jobsBase+path+'?run='+runId});jobIds.push(job.id);
    const started=await api('POST',`/jobs/${job.id}/start`,{});
    const p=await newPage(job.url);await p.evaluate(marker=>{window.name=marker;},'ichigo:'+started.session.id);
    await track(job.id,started.session.id,[p]);return {job,session:started.session,p};
  }
  async function track(id,sessionId,pages){
    const records=[];for(const p of pages)if(!p.isClosed())records.push({url:p.url(),title:await p.title(),marker:await p.evaluate(()=>window.name)});
    await api('POST',`/jobs/${id}/pages`,{sessionId,pages:records});
  }
  async function capture(id,p){
    const png=await p.screenshot({fullPage:true,type:'png'});
    const {job}=await api('POST',`/jobs/${id}/screenshot`,{pngBase64:png.toString('base64')});
    const image=await context.request.get(appBase+job.screenshot);
    check(image.ok()&&(await image.body()).subarray(0,8).toString('hex')==='89504e470d0a1a0a','Full-page screenshot saved and readable over HTTP：'+id);
    return job;
  }
  async function finishAndClose(id,sessionId,result){
    // Recover page identity from storage, rather than relying on stale tab indices.
    const before=(await api('GET','/jobs/'+id)).job;
    const session=before.sessions.find(s=>s.id===sessionId);
    if(!session)return (await api('POST',`/jobs/${id}/result`,{sessionId,result})).job;
    const candidates=[];
    for(const p of context.pages()){
      if(p.isClosed())continue;
      const marker=await p.evaluate(()=>window.name);
      if(marker==='ichigo:'+sessionId || session.pages.some(r=>r.url===p.url()&&createdPages.includes(p)))candidates.push(p);
    }
    const after=(await api('POST',`/jobs/${id}/result`,{sessionId,result})).job;
    for(const p of candidates)await p.close();
    return after;
  }
  let failure=null;
  try{
    const health=await api('GET','/health');check(health.service==='ichigo','Real backend health check');
    const unrelated=await newPage(jobsBase+'/unrelated');
    const main=await begin('/jobs/engineer');
    const metadata=await main.p.evaluate(()=>({company:document.querySelector('[data-company]').textContent,title:document.querySelector('h1').textContent,location:document.querySelector('[data-location]').textContent,actualUrl:location.href,text:document.querySelector('main').innerText}));
    await api('PATCH','/jobs/'+main.job.id,metadata);
    const duplicate=await api('POST','/jobs',{url:main.job.url});check(duplicate.job.id===main.job.id&&!duplicate.created,'Real HTTP reuses job for the same URL');
    const captured=await capture(main.job.id,main.p);
    check(captured.text.includes('language model')&&captured.stage==='applying','Job text extracted and Applying stage preserved');
    const popupWait=main.p.waitForEvent('popup');await main.p.getByText('Open application popup',{exact:true}).click();
    const popup=await popupWait;createdPages.push(popup);await popup.waitForLoadState('domcontentloaded');
    check((await popup.opener())===main.p&&popup.url().startsWith(alternateBase),'Cross-origin application popup and opener relationship');
    await popup.evaluate(marker=>{window.name=marker;},'ichigo:'+main.session.id);
    await popup.locator('input[name=name]').fill('Local integration fixture');
    await popup.getByRole('button',{name:'Submit Local Mock Application'}).click();
    await popup.getByRole('heading',{name:'Mock application submitted'}).waitFor();check(true,'Local mock application form completed');
    const redirect=await newPage(jobsBase+'/redirect');
    check(redirect.url().startsWith(alternateBase+'/apply'),'Real HTTP cross-origin redirect');
    await redirect.evaluate(marker=>{window.name=marker;},'ichigo:'+main.session.id);
    await track(main.job.id,main.session.id,[main.p,popup,redirect]);
    const recovered=(await api('GET','/jobs/'+main.job.id)).job;
    check(recovered.sessions[0].pages.length===3,'Restored job and three associated pages from database');
    // Force a real API rejection; never close pages when writing the result fails.
    let failed=false;try{await finishAndClose(main.job.id,'invalid-session','applied');}catch{failed=true;}
    check(failed&&!main.p.isClosed()&&!popup.isClosed()&&!redirect.isClosed(),'All associated pages remain open when result save fails');
    await page.goto(`${appBase}/?e2e=${runId}#job/${main.job.id}`);
    await page.locator('#drawer h2').filter({hasText:metadata.title}).waitFor();
    await page.locator('.capture').waitFor();
    await page.waitForFunction(()=>document.querySelector('.capture').complete&&document.querySelector('.capture').naturalWidth>0);
    check(await page.locator('#detail-stage').inputValue()==='applying','Frontend displays Applying stage and full-page screenshot');
    const finished=await finishAndClose(main.job.id,main.session.id,'applied');
    check(finished.stage==='applied'&&!!finished.appliedAt,'Actual application time recorded in SQLite');
    check(main.p.isClosed()&&popup.isClosed()&&redirect.isClosed()&&!unrelated.isClosed(),'Only associated pages closed; unrelated page preserved');
    const again=(await api('POST',`/jobs/${main.job.id}/result`,{sessionId:main.session.id,result:'applied'})).job;
    check(again.history.length===finished.history.length,'Repeated result call does not add history');
    await page.bringToFront();
    await page.waitForFunction(id=>!!document.querySelector(`.column[data-stage=applied] .card[data-id="${id}"]`),main.job.id,{timeout:15000});
    await page.waitForFunction(()=>document.querySelector('#detail-stage')?.value==='applied',null,{timeout:10000});
    check(true,'Board and open details sync updated result');
    await page.locator('#close-detail').click();

    const login=await begin('/jobs/private');
    check(await login.p.getByRole('heading',{name:'Please sign in first'}).count()===1,'Mock sign-in wall');
    await api('POST',`/jobs/${login.job.id}/screenshot`,{status:'blocked',error:'Sign in to recapture'});
    await login.p.getByRole('button',{name:'Mock Sign In'}).click();
    await login.p.getByRole('heading',{name:'AI Engineer — Local Integration Test'}).waitFor();
    const recaptured=await capture(login.job.id,login.p);
    check(recaptured.screenshotStatus==='ready'&&recaptured.stage==='applying'&&recaptured.sessions.length===1,'Recaptured after sign-in without new application or stage change');
    const bad=await newPage(jobsBase+'/fail');
    const response=await bad.goto(jobsBase+'/fail');check(response.status()===503,'Real load failure status');
    const blocked=await api('POST',`/jobs/${login.job.id}/screenshot`,{status:'failed',error:'Mock load failure HTTP 503'});
    check(blocked.job.screenshot===recaptured.screenshot,'Screenshot failure preserves previous image');await bad.close();
    await finishAndClose(login.job.id,login.session.id,'saved');
    check((await api('GET','/jobs/'+login.job.id)).job.stage==='saved','Not applied result returns to To Apply');

    const early=await begin('/jobs/early-close');await early.p.close();
    check((await api('GET','/jobs/'+early.job.id)).job.stage==='applying','User closing page does not change stage automatically');
    await finishAndClose(early.job.id,early.session.id,'pending');
    check((await api('GET','/jobs/'+early.job.id)).job.stage==='pending','Pending result can be saved after page was closed');
    check(!unrelated.isClosed(),'Unrelated page remains open after multiple operations');
  }catch(error){failure=error.message;}
  finally{
    // All pages here belong to this local integration run. Preserve every pre-existing page.
    for(const id of jobIds){try{const j=(await api('GET','/jobs/'+id)).job;const active=j.sessions.find(s=>!s.endedAt);if(active)await api('POST',`/jobs/${id}/result`,{sessionId:active.id,result:'saved'});}catch{}}
    for(const p of createdPages)if(!p.isClosed())await p.close();
  }
  return {passed:failure===null,checks,error:failure,jobIds,runId};
}
