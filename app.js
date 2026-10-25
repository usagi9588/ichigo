const stages=[['saved','To Apply','#aba4b8'],['applying','Applying','#9a8cca'],['pending','Pending','#cfad72'],['applied','Applied','#83a6ca'],['interview','Interview','#8b90ce'],['offer','Offer','#7eaf98'],['rejected','Rejected','#c9909c'],['archived','Archived','#a6a1ab']];
const $=s=>document.querySelector(s);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stageName=id=>stages.find(s=>s[0]===id)?.[1]??id;
const date=value=>value?new Date(value).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'Not recorded';
let jobs=[],view='all',layout='board',selected=null,dragId=null,loading=true,online=false,mutating=false,loadSequence=0;
let dirtyFields=new Set(),commandText='',resultTarget=null,addStage='saved';
async function api(path,options={}){
  let response;
  try{response=await fetch('/api'+path,{...options,headers:{'content-type':'application/json',...options.headers},signal:AbortSignal.timeout(15000)});}
  catch{throw new Error('Cannot connect to the local service. Run npm start from the project directory');}
  let data;try{data=await response.json();}catch{throw new Error('Unexpected service response. Open this page through the Ichigo local service');}
  if(!response.ok)throw new Error(data.error||'Save failed. Please try again');return data;
}
const post=(path,body)=>api(path,{method:'POST',body:JSON.stringify(body)});
const patch=(id,body)=>api('/jobs/'+id,{method:'PATCH',body:JSON.stringify(body)});
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),4000);}
function connection(message){$('#connection').textContent=message;$('#connection').classList.toggle('error',!online);}
function upsert(job){const index=jobs.findIndex(j=>j.id===job.id);if(index<0)jobs.unshift(job);else jobs[index]=job;render();}
async function action(fn){
  if(mutating)return false;++loadSequence;mutating=true;document.body.classList.add('saving');
  try{await fn();return true;}catch(error){toast(error.message);return false;}finally{mutating=false;document.body.classList.remove('saving');}
}
async function refresh(){
  if(mutating||dragId!==null)return;const sequence=++loadSequence;
  try{
    const data=await api('/jobs');if(sequence!==loadSequence||mutating)return;
    jobs=data.jobs;online=true;loading=false;connection('Connected · Data is stored in local SQLite');render();
    const focused=document.activeElement;
    const inDrawer=$('#drawer').contains(focused);
    const editing=inDrawer&&focused.matches('input,textarea,select');
    if(selected&&!dirtyFields.size&&!editing){
      const focusId=inDrawer?focused.id:null;
      renderDrawer();
      if(focusId)document.getElementById(focusId)?.focus({preventScroll:true});
    }
  }catch(error){if(sequence!==loadSequence)return;loading=false;online=false;connection(error.message);render();}
}
function render(){
  const query=$('#search').value.toLowerCase(),mode=$('#type').value;
  const visible=jobs.filter(j=>(j.company+' '+j.title).toLowerCase().includes(query)&&(!mode||j.mode===mode)&&(view==='all'||j.stage===(view==='pending'?'pending':'saved')));
  $('#total').textContent=jobs.length;$('#pending').textContent=jobs.filter(j=>j.stage==='pending').length;
  $('#stat-total').textContent=jobs.filter(j=>!['rejected','archived'].includes(j.stage)).length;
  for(const [id,stage]of[['stat-pending','pending'],['stat-interview','interview'],['stat-offer','offer']])$('#'+id).textContent=jobs.filter(j=>j.stage===stage).length;
  $('#board').className='board'+(layout==='list'?' list':'');
  if(loading){$('#board').innerHTML='<p class="empty">Loading jobs…</p>';return;}
  if(!online&&!jobs.length){$('#board').innerHTML='<div class="empty">Local service is disconnected. Start it, then click “Reconnect”.</div>';return;}
  $('#board').innerHTML=stages.filter(([id])=>view==='all'||id===(view==='pending'?'pending':'saved')).map(([id,name,color])=>{
    const items=visible.filter(j=>j.stage===id);
    return `<section class="column" data-stage="${id}" style="--color:${color}"><div class="column-head"><span class="stage-dot"></span>${name}<span class="count">${items.length}</span><button class="column-add" aria-label="Add a job to ${name}">＋</button></div>${items.map(card).join('')}${items.length?'':'<div class="empty">Leave room for your next opportunity</div>'}<button class="add-card">＋ Add Job</button></section>`;
  }).join('');
  document.querySelectorAll('.card').forEach(el=>{
    el.onclick=()=>navigateDetail(Number(el.dataset.id));
    el.ondragstart=e=>{dragId=Number(el.dataset.id);e.dataTransfer.setData('text/plain',el.dataset.id);e.dataTransfer.effectAllowed='move';el.classList.add('dragging');};
    el.ondragend=()=>{dragId=null;el.classList.remove('dragging');document.querySelectorAll('.over').forEach(x=>x.classList.remove('over'));};
  });
  document.querySelectorAll('.column').forEach(el=>{
    el.ondragover=e=>{e.preventDefault();el.classList.add('over');};
    el.ondragleave=e=>{if(!el.contains(e.relatedTarget))el.classList.remove('over');};
    el.ondrop=e=>{e.preventDefault();el.classList.remove('over');const id=Number(e.dataTransfer.getData('text/plain'))||dragId;if(id)move(id,el.dataset.stage);};
    el.querySelectorAll('.column-add,.add-card').forEach(b=>b.onclick=()=>showAdd(el.dataset.stage));
  });
}
const isPdfCapture=j=>!!j.screenshot&&j.screenshot.endsWith('.pdf');
const screenshotLabel=j=>j.screenshotStatus==='ready'?(isPdfCapture(j)?'Job PDF':'Full-page job screenshot'):j.screenshotStatus==='blocked'?'Sign in to recapture':j.screenshotStatus==='failed'?'Capture failed':'No capture yet';
function captureMarkup(j){
  if(!j.screenshot)return '<div class="empty">No capture yet. Ask Codex to open the job and save a full-page screenshot.</div>';
  return isPdfCapture(j)?`<a class="secondary capture-link" href="${escape(j.screenshot)}" target="_blank" rel="noopener noreferrer">Open PDF ↗</a>`:`<a class="capture-link" href="${escape(j.screenshot)}" target="_blank" rel="noopener noreferrer"><img class="capture" src="${escape(j.screenshot)}" alt="Full-page job screenshot" loading="lazy"></a>`;
}
function card(j){return `<article class="card ${j.stage==='pending'?'confirm-card':''}" draggable="true" tabindex="0" role="button" aria-label="View ${escape(j.company||'Company not provided')} ${escape(j.title||'Title not provided')}" data-id="${j.id}"><div class="company-row"><span class="company-logo">${escape(j.logo)}</span><span class="company-name">${escape(j.company||'Company not provided')}</span><span class="card-menu">···</span></div><h3>${escape(j.title||'Title not provided')}</h3><div class="location">⌖ ${escape(j.location||'Location not provided')}</div><div class="tags">${j.mode?`<span class="tag ${j.mode==='Remote'?'remote':''}">${escape(j.mode)}</span>`:''}${j.tag?`<span class="tag">${escape(j.tag)}</span>`:''}${j.salary?`<span class="tag salary">${escape(j.salary)}</span>`:''}</div>${j.stage==='pending'?'<div class="pending-hint">◷ Awaiting application result</div>':''}<div class="card-foot"><span>▧ ${screenshotLabel(j)}</span><span>${escape(date(j.updatedAt))}</span></div></article>`;}
async function move(id,stage){
  const j=jobs.find(j=>j.id===id);if(!j||j.stage===stage)return;
  if(stage==='applying'){showCommand(id);return;}
  if(j.sessions.some(s=>!s.endedAt)){toast('Record the current application result in job details first');return;}
  if(stage==='applied'){showResult(id,'applied');return;}
  await action(async()=>{upsert((await patch(id,{stage})).job);if(selected===id&&!dirtyFields.size)renderDrawer();toast('Moved to '+stageName(stage));});
}
function navigateDetail(id){if(mutating){toast('Saving. Please wait before switching jobs');return;}if(location.hash===`#job/${id}`)openDetail(id);else location.hash=`job/${id}`;}
async function openDetail(id){
  if(selected!==id)dirtyFields.clear();selected=id;
  if(!jobs.some(j=>j.id===id)){
    try{upsert((await api('/jobs/'+id)).job);}catch(error){toast(error.message);return;}
  }
  $('#overlay').hidden=false;$('#drawer').hidden=false;renderDrawer();$('#close-detail')?.focus();
}
function closeDetail(){
  if(mutating){toast('Saving. Please wait before closing details');return;}
  if(dirtyFields.size&&!confirm('You have unsaved edits. Close details anyway?'))return;
  $('#drawer').hidden=true;$('#overlay').hidden=true;selected=null;dirtyFields.clear();history.replaceState(null,'',location.pathname+location.search);
}
function renderDrawer(){
  const j=jobs.find(j=>j.id===selected);if(!j)return;
  const active=j.sessions.find(s=>!s.endedAt);
  const field=(name,label,type='text')=>`<label>${label}<input name="${name}" type="${type}" value="${escape(j[name])}"></label>`;
  const safeLink=value=>/^https?:\/\//i.test(value||'')?escape(value):'#';
  $('#drawer').innerHTML=`<div class="drawer-top"><span>Job Details / ${j.id}</span><button class="close" id="close-detail" aria-label="Close details">×</button></div><div class="company-row"><span class="company-logo">${escape(j.logo)}</span><span class="company-name">${escape(j.company||'Company not provided')}</span></div><h2>${escape(j.title||'Title not provided')}</h2><div class="location">⌖ ${escape(j.location||'Location not provided')} ${escape(j.mode)}</div><div class="detail-actions"><button class="primary" id="apply-command">↗ ${active?'Continue Application':'Apply to This Job'}</button><a class="secondary" href="${safeLink(j.url)}" target="_blank" rel="noopener noreferrer">Original Job ↗</a></div><div class="detail-section"><h3>Current Stage</h3><select id="detail-stage" ${active?'disabled':''}>${stages.map(([id,name])=>`<option value="${id}" ${j.stage===id?'selected':''} ${id==='applying'&&!active?'disabled':''}>${name}</option>`).join('')}</select>${active?'<p>Codex operates the browser. Tell Codex the result and ask it to close the page, or record the result below. This will not close the browser.</p>':''}${j.stage==='pending'||active?'<div class="detail-actions"><button class="primary" id="confirm-applied">Confirm Applied</button><button class="secondary" id="return-saved">Return to To Apply</button></div>':''}${j.stage==='pending'?'<button class="secondary" id="archive-job">Archived</button>':''}${active?'<button class="secondary" id="mark-pending">Finish as Pending</button>':''}${j.appliedAt?`<p>Applied on: ${escape(date(j.appliedAt))}</p>`:''}</div><div class="detail-section"><h3>Job Snapshot</h3><p>${screenshotLabel(j)}${j.screenshotError?' · '+escape(j.screenshotError):''}</p>${captureMarkup(j)}<button class="secondary" id="recapture">Copy Recapture Command</button></div><div class="detail-section"><h3>Job Information <span class="muted">You can fill this in</span></h3><form id="edit-job">${field('company','Company')}${field('title','Title')}${field('url','Source URL','url')}${field('actualUrl','Visited URL','url')}${field('location','Location')}${field('mode','Work Mode')}${field('salary','Salary')}${field('tag','Tags')}<label>Job Description<textarea name="text">${escape(j.text)}</textarea></label><button class="primary" type="submit">Save Job Information</button></form></div><div class="detail-section"><h3>Notes</h3><textarea id="notes" placeholder="Interview details, contacts, or your thoughts about this role…">${escape(j.notes)}</textarea><p id="notes-status">Saved when you leave the field. Your input stays if saving fails.</p><button class="secondary" id="save-notes">Save Notes</button></div><div class="detail-section"><h3>Applications</h3>${j.sessions.length?j.sessions.map(s=>`<p>${escape(date(s.startedAt))} → ${s.endedAt?escape(stageName(s.result)):'In progress'}${s.appliedAt?' · Applied on '+escape(date(s.appliedAt)):''}</p>`).join(''):'<p>No application started yet</p>'}</div><div class="detail-section"><h3>Activity</h3><div class="timeline">${[...j.history].reverse().map(h=>`<p>${escape(h.text)}<small>${escape(date(h.time))}</small></p>`).join('')}</div></div>`;
  $('#close-detail').onclick=closeDetail;$('#apply-command').onclick=()=>showCommand(j.id);
  $('#recapture').onclick=()=>showCommand(j.id,true);
  $('#detail-stage').onchange=e=>move(j.id,e.target.value).then(()=>{if(!dirtyFields.size)renderDrawer();});
  if($('#confirm-applied'))$('#confirm-applied').onclick=()=>showResult(j.id,'applied');
  if($('#return-saved'))$('#return-saved').onclick=()=>recordResult(j.id,'saved');
  if($('#mark-pending'))$('#mark-pending').onclick=()=>recordResult(j.id,'pending');
  if($('#archive-job'))$('#archive-job').onclick=()=>move(j.id,'archived');
  $('#edit-job').oninput=()=>dirtyFields.add('fields');
  $('#edit-job').onsubmit=async e=>{
    e.preventDefault();const form=e.currentTarget;const values=Object.fromEntries(new FormData(form));
    await action(async()=>{
      const data=await patch(j.id,values);upsert(data.job);
      if(JSON.stringify(Object.fromEntries(new FormData(form)))===JSON.stringify(values))dirtyFields.delete('fields');
      toast('Job information saved');
    });
  };
  $('#notes').oninput=()=>{dirtyFields.add('notes');$('#notes-status').textContent='Unsaved notes';};
  const saveNotes=async()=>{
    if(!dirtyFields.has('notes'))return;const input=$('#notes');const value=input.value;
    const ok=await action(async()=>{upsert((await patch(j.id,{notes:value})).job);if(input.value===value){dirtyFields.delete('notes');$('#notes-status').textContent='Saved to local SQLite';}});
    if(!ok)$('#notes-status').textContent='Not saved. Click “Save Notes” to try again';
  };
  $('#notes').onchange=saveNotes;$('#save-notes').onclick=saveNotes;
}
function showCommand(id,recapture=false){
  commandText=recapture?`Use Ichigo’s apply-job skill to recapture a full-page screenshot for job ${id} and keep its current application stage.`:`Use Ichigo’s apply-job skill to apply to job ${id}. Open the page and save a full-page screenshot. I will fill out and submit the application manually.`;
  $('#command-text').value=commandText;$('#command-dialog').showModal();
}
$('#copy-command').onclick=async()=>{try{await navigator.clipboard.writeText(commandText);toast('Command copied. Paste it into Codex.');}catch{$('#command-text').select();toast('Please copy the selected command manually');}};
function showResult(id,result){
  resultTarget={id,result};const now=new Date();$('#applied-at').value=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);$('#result-dialog').showModal();
}
async function recordResult(id,result,appliedAt){
  const job=jobs.find(j=>j.id===id),active=job?.sessions.find(s=>!s.endedAt);
  return action(async()=>{
    const data=active?await post(`/jobs/${id}/result`,{sessionId:active.id,result,...(appliedAt?{appliedAt}:{})}):await patch(id,{stage:result,...(appliedAt?{appliedAt}:{})});
    upsert(data.job);if(selected===id&&!dirtyFields.size)renderDrawer();toast('Saved as '+stageName(result));
  });
}
$('#result-form').onsubmit=async e=>{e.preventDefault();if(!resultTarget)return;const value=$('#applied-at').value;const at=new Date(value);if(!Number.isFinite(at.getTime())){toast('Select a valid application time');return;}if(await recordResult(resultTarget.id,resultTarget.result,at.toISOString()))$('#result-dialog').close();};
function showAdd(stage='saved'){addStage=stage==='applying'?'saved':stage;$('#add-form .form-hint').textContent=`Saved to “${stageName(addStage)}”. Copy the command from its details to have Codex open the application page.`;$('#add-dialog').showModal();}
$('#add').onclick=()=>showAdd();$('#close-add').onclick=()=>$('#add-dialog').close();$('#overlay').onclick=closeDetail;
$('#add-form').onsubmit=async e=>{
  e.preventDefault();const form=e.currentTarget,data=Object.fromEntries(new FormData(form));
  let savedId=null;
  const ok=await action(async()=>{const result=await post('/jobs',{...data,stage:addStage});upsert(result.job);$('#add-dialog').close();form.reset();toast(result.created?'New opportunity added to the board':'This URL is already on the board');savedId=result.job.id;});
  if(ok&&savedId)navigateDetail(savedId);
};
$('#search').oninput=render;$('#type').onchange=render;$('#reset').onclick=()=>{$('#search').value='';$('#type').value='';render();};
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>{view=b.dataset.view;document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n===b));render();});
$('#board-view').onclick=()=>{layout='board';$('#board-view').classList.add('selected');$('#list-view').classList.remove('selected');render();};
$('#list-view').onclick=()=>{layout='list';$('#list-view').classList.add('selected');$('#board-view').classList.remove('selected');render();};
$('#help').onclick=()=>toast('Use Codex to open the job, then apply manually. Tell Codex the result to save it and close the page. Drag cards to update their stage.');
$('.amber-text').onclick=()=>document.querySelector('[data-view="pending"]').click();
$('#reconnect').onclick=refresh;
document.querySelectorAll('[data-close-dialog]').forEach(b=>b.onclick=()=>$('#'+b.dataset.closeDialog).close());
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&![...document.querySelectorAll('dialog')].some(d=>d.open))closeDetail();
  if((e.key==='Enter'||e.key===' ')&&e.target.matches('.card')){e.preventDefault();navigateDetail(Number(e.target.dataset.id));}
});
$('#drawer').addEventListener('keydown',e=>{
  if(e.key!=='Tab')return;const els=[...$('#drawer').querySelectorAll('button,a,input,select,textarea')].filter(x=>!x.disabled);const first=els[0],last=els.at(-1);
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
});
function legacyJobs(){try{const data=JSON.parse(localStorage.getItem('orbit-jobs-v1')||'[]');return Array.isArray(data)?data.filter(j=>Number.isSafeInteger(j.id)&&j.id>12):[];}catch{return [];}}
async function importJobs(data){
  if(!Array.isArray(data)){toast('Import file must be an array of jobs or an object containing a jobs array');return;}
  await action(async()=>{
    const result=await post('/import',{jobs:data});
    if(result.errors.length){toast(`Imported ${result.imported} jobs; ${result.errors.length}; ${result.errors[0].error}. Original data is retained; fix the issue and retry.`);}
    else{toast(`Import complete: ${result.imported} jobs; skipped ${result.skipped} jobs. Original data is retained.`);$('#legacy-banner').hidden=true;}
    jobs=(await api('/jobs')).jobs;online=true;render();
  });
}
$('#import-local').onclick=()=>importJobs(legacyJobs());
$('#import-file').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>5*1024*1024)throw new Error('Import file must be 5 MB or smaller');const data=JSON.parse(await file.text());await importJobs(Array.isArray(data)?data:data.jobs);}catch(error){toast(error.message);}finally{e.target.value='';}};
$('#legacy-banner').hidden=legacyJobs().length===0;
function followHash(){const match=location.hash.match(/^#job\/([1-9]\d*)$/);if(match){const id=Number(match[1]);if(selected!==null&&selected!==id&&(mutating||(dirtyFields.size&&!confirm('You have unsaved edits. Switch jobs anyway?')))){history.replaceState(null,'',`#job/${selected}`);return;}openDetail(id);}else if(selected)closeDetail();}
window.addEventListener('hashchange',followHash);
window.addEventListener('beforeunload',e=>{if(dirtyFields.size){e.preventDefault();e.returnValue='';}});
refresh().then(followHash);setInterval(()=>{if(!document.hidden)refresh();},5000);
