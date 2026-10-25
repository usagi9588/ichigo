// Execute with the connected Playwright MCP using run(page, {html, css, js}).
// Browser uses controlled API fixtures; backend behavior is covered separately by node:test.
export async function run(page, assets) {
  const checks=[];
  const check=(condition,label)=>{if(!condition)throw new Error(label);checks.push(label);};
  let jobs=[],nextId=1,failNotes=false,failStage=false;
  const requests=[];
  const fixture=input=>({id:nextId++,url:input.url,actualUrl:'',company:input.company||'',title:input.title||'',location:input.location||'',mode:input.mode||'Remote',salary:'',tag:'',text:'',notes:'',stage:'saved',logo:'A',color:'#eee8fa',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),appliedAt:null,screenshotStatus:'missing',screenshotError:'',screenshot:null,history:[{text:'Job added',time:new Date().toISOString()}],sessions:[]});
  page.setDefaultTimeout(8000);
  await page.unroute('http://ichigo.test/**');
  await page.route('http://ichigo.test/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(path==='/')return route.fulfill({contentType:'text/html',body:assets.html});
    if(path==='/style.css')return route.fulfill({contentType:'text/css',body:assets.css});
    if(path==='/app.js')return route.fulfill({contentType:'text/javascript',body:assets.js});
    if(path.startsWith('/screenshots/'))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64')});
    const body=req.postDataJSON()||{};requests.push({method:req.method(),path,body});
    let status=200,result;
    if(path==='/api/jobs'&&req.method()==='GET')result={jobs};
    else if(path==='/api/jobs'&&req.method()==='POST'){const j=fixture(body);jobs.push(j);result={job:j,created:true};status=201;}
    else if(path==='/api/import')result={imported:0,skipped:body.jobs.length,errors:[]};
    else {
      const match=path.match(/^\/api\/jobs\/(\d+)$/),j=match&&jobs.find(j=>j.id===Number(match[1]));
      if(!j){status=404;result={error:'Job not found'};}
      else if(req.method()==='PATCH'){
        if((failNotes&&body.notes!==undefined)||(failStage&&body.stage!==undefined)){status=500;result={error:'Test save failed'};}
        else {Object.assign(j,body);j.updatedAt=new Date().toISOString();j.history.push({text:'Updated job',time:j.updatedAt});result={job:j};}
      }else result={job:j};
    }
    return route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://ichigo.test/');
  await page.getByText('Connected · Data is stored in local SQLite',{exact:true}).waitFor();
  check(await page.locator('.card').count()===0,'Empty database has no demo jobs');
  check(await page.title()==='Ichigo · Job Tracker','Ichigo title');
  check(await page.locator('.brand-icon').textContent()==='🍓','Strawberry logo');
  await page.locator('#add').click();
  await page.locator('#add-form input[name=url]').fill('https://jobs.example/one');
  await page.locator('#add-form input[name=company]').fill('Acme');
  await page.locator('#add-form input[name=title]').fill('AI Engineer');
  await page.locator('#add-form button[type=submit]').click();
  await page.locator('#drawer h2').filter({hasText:'AI Engineer'}).waitFor();
  check(await page.locator('.card').count()===1,'Job added through API');
  await page.locator('#apply-command').click();
  check((await page.locator('#command-text').inputValue()).includes('job 1'),'Application command contains job ID');
  await page.locator('[data-close-dialog=command-dialog]').click();
  await page.locator('#recapture').click();
  check((await page.locator('#command-text').inputValue()).includes('recapture'),'Recapture command preserves stage');
  await page.locator('[data-close-dialog=command-dialog]').click();
  await page.locator('#edit-job input[name=company]').fill('Acme Updated');
  await page.locator('#edit-job textarea[name=text]').fill('Real job description');
  await page.locator('#edit-job button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Job information saved');
  check(jobs[0].company==='Acme Updated'&&jobs[0].text==='Real job description','Job field changes persisted');
  failNotes=true;
  await page.locator('#notes').fill('unsaved note');
  await page.locator('#save-notes').click();
  await page.getByText('Not saved. Click “Save Notes” to try again',{exact:true}).waitFor();
  check(await page.locator('#notes').inputValue()==='unsaved note','Failed save preserves notes input');
  failNotes=false;await page.locator('#save-notes').click();
  await page.getByText('Saved to local SQLite',{exact:true}).waitFor();
  check(jobs[0].notes==='unsaved note','Notes saved on retry');
  await page.locator('#close-detail').click();
  await page.locator('#search').fill('Missing');
  check(await page.locator('.card').count()===0,'Search filtering');
  await page.locator('#reset').click();
  await page.locator('#list-view').click();
  check(await page.locator('#board').getAttribute('class')==='board list','List view toggle');
  jobs[0].stage='pending';
  await page.locator('#reconnect').evaluate(el=>el.click());
  await page.locator('.confirm-card').waitFor();
  await page.locator('.card').click();
  await page.locator('#confirm-applied').click();
  await page.locator('#applied-at').fill('2026-10-22T10:30');
  await page.locator('#result-form button[type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('#result-dialog').open);
  check(jobs[0].stage==='applied'&&!!jobs[0].appliedAt,'Application confirmation and actual time');
  await page.locator('#notes').fill('draft during polling');
  await page.locator('#reconnect').evaluate(el=>el.click());
  await page.waitForTimeout(100);
  check(await page.locator('#notes').inputValue()==='draft during polling','Refresh preserves unsaved notes');
  await page.locator('#save-notes').click();
  await page.getByText('Saved to local SQLite',{exact:true}).waitFor();
  await page.locator('#close-detail').click();
  await page.locator('#board-view').click();
  const drop=stage=>page.evaluate(stage=>{const card=document.querySelector('.card'),column=document.querySelector('.column[data-stage='+stage+']');const dataTransfer=new DataTransfer();card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer}));column.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer}));column.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));card.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer}));},stage);
  await drop('interview');
  await page.locator('.column[data-stage=interview] .card').waitFor();
  check(jobs[0].stage==='interview','Drag and drop updates stage');
  failStage=true;
  await drop('offer');
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Test save failed');
  check(jobs[0].stage==='interview'&&await page.locator('.column[data-stage=interview] .card').count()===1,'Failed write does not report successful move');
  failStage=false;
  await page.setViewportSize({width:390,height:844});
  check(await page.locator('#add').isVisible(),'Add action remains visible in mobile layout');
  await page.setViewportSize({width:1440,height:1000});
  jobs[0].stage='pending';jobs[0].screenshot='/screenshots/1-fixture.png';jobs[0].screenshotStatus='ready';
  await page.locator('#reconnect').evaluate(el=>el.click());await page.locator('.confirm-card').waitFor();await page.locator('.card').click();
  await page.locator('.capture').waitFor();
  await page.waitForFunction(()=>document.querySelector('.capture').complete&&document.querySelector('.capture').naturalWidth>0);
  check(true,'PNG rendering and full-page screenshot link');
  jobs[0].screenshot='/screenshots/1-fixture.pdf';
  await page.locator('#reconnect').evaluate(el=>el.click());
  await page.getByRole('link',{name:'Open PDF'}).waitFor();
  check(await page.locator('.capture').count()===0,'PDF capture uses a link instead of an image');
  check((await page.getByRole('link',{name:'Open PDF'}).getAttribute('href')).endsWith('.pdf'),'PDF link targets stored capture');
  check((await page.locator('.card-foot').textContent()).includes('Job PDF'),'PDF capture format shown on card');
  jobs[0].screenshotStatus='failed';jobs[0].screenshotError='PDF recapture failed';
  await page.locator('#reconnect').evaluate(el=>el.click());
  await page.getByText('Capture failed · PDF recapture failed',{exact:true}).waitFor();
  check(await page.getByRole('link',{name:'Open PDF'}).isVisible(),'Previous PDF remains accessible after recapture failure');

  await page.locator('#return-saved').click();
  await page.waitForFunction(()=>document.querySelector('#detail-stage').value==='saved');
  check(jobs[0].stage==='saved','Pending returned to To Apply');
  await page.locator('#close-detail').click();jobs[0].stage='pending';
  await page.locator('#reconnect').evaluate(el=>el.click());await page.locator('.confirm-card').waitFor();await page.locator('.card').click();
  await page.locator('#archive-job').click();
  await page.waitForFunction(()=>document.querySelector('#detail-stage').value==='archived');
  check(jobs[0].stage==='archived','Pending archived');
  await page.locator('#edit-job input[name=title]').fill('unsaved field');
  await page.locator('#reconnect').evaluate(el=>el.click());await page.waitForTimeout(100);
  check(await page.locator('#edit-job input[name=title]').inputValue()==='unsaved field','Refresh preserves unsaved job fields');
  await page.locator('#edit-job button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Job information saved');
  await page.locator('#close-detail').click();
  check(errors.length===0,'No unhandled JavaScript errors');
  await page.setViewportSize({width:1440,height:1000});
  await page.unroute('http://ichigo.test/**');
  return {checks,requests:requests.length,errors};
}
