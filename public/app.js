let exercises=[];
let index=0;
let hintLevel=0;
let modelViewed=false;
let correctToday=new Set();
let mastery=[];
let currentGroupId=null;
let currentSessionId=null;
let sessionItems=[];
let currentPracticeMode="today";
let answerSaveTimer=null;

const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function metric(label,value){
 return '<div class="metric">'+label+'<b>'+(value==="ok"?"✓":value==="not_applicable"?"—":"△")+'</b></div>';
}

async function get(url){
 const r=await fetch(url);
 const type=r.headers.get("content-type")||"";
 const data=type.includes("application/json")?await r.json():await r.text();
 if(!r.ok) throw new Error(typeof data==="string"?("Server error "+r.status):(data.error||("Server error "+r.status)));
 return data;
}

async function post(url,body){
 const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})});
 const d=await r.json();
 if(!r.ok) throw new Error(d.error||("Server error "+r.status));
 return d;
}

async function patch(url,body){
 const r=await fetch(url,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})});
 const d=await r.json();
 if(!r.ok) throw new Error(d.error||("Server error "+r.status));
 return d;
}

function activateView(name){
 document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.view===name));
 document.querySelectorAll(".view").forEach(x=>x.classList.add("hidden"));
 $(name+"View").classList.remove("hidden");
}

function sessionItemAt(i){
 return currentSessionId?sessionItems[i]:null;
}

function showFeedback(d){
 $("result").className="result "+(d.correct?"ok":"bad");
 $("result").innerHTML='<strong>'+(d.correct?"✓ Good sentence":"Revise this sentence")+'</strong>'+
  '<div class="grid">'+metric("Meaning",d.meaning)+metric("Grammar",d.grammar)+metric("Tense",d.tense)+metric("Capital",d.capitalization)+metric("Punctuation",d.punctuation)+'</div>'+
  '<p><b>Feedback:</b> '+esc(d.feedback)+'</p>'+
  '<p><b>Suggestion:</b> '+esc(d.suggestion)+'</p>'+
  '<p><b>Better sentence:</b> '+esc(d.betterSentence)+'</p>'+
  (d.evidenceScore===undefined?"":'<p class="muted"><b>Mastery evidence:</b> '+Math.round(d.evidenceScore*100)+'%</p>');
}

function render(){
 if(!exercises.length) return;
 index=Math.max(0,Math.min(index,exercises.length-1));
 const q=exercises[index];
 const state=sessionItemAt(index);
 $("type").textContent=String(q.type||"practice").replaceAll("_"," ");
 $("focus").textContent=q.focus||q.skill||"";
 $("prompt").textContent=q.prompt||"";
 $("progressText").textContent=(index+1)+" / "+exercises.length;
 $("progressBar").style.width=((index+1)/exercises.length*100)+"%";
 $("score").textContent="Completed "+correctToday.size+" / "+exercises.length;
 $("answer").value=state?.answer||"";
 hintLevel=state?.hint_level||0;
 modelViewed=Boolean(state?.model_viewed);
 $("result").className="result hidden";
 $("hint").className="notice hint hidden";
 $("model").className="notice model hidden";
 if(state?.feedback) showFeedback(state.feedback);
 if(hintLevel>0){
  $("hint").classList.remove("hidden");
  $("hint").innerHTML="<b>Hint "+hintLevel+":</b> "+esc(q.hints?.[hintLevel-1]||"");
 }
 if(modelViewed){
  $("model").classList.remove("hidden");
  $("model").innerHTML='<b>One model answer:</b> '+esc(q.model)+'<br><span class="muted">Other natural answers can also be correct.</span>';
 }
 $("answer").focus();
}

function applySession(payload,{title=null,meta=null}={}){
 currentSessionId=payload.session.id;
 currentGroupId=payload.session.group_id;
 currentPracticeMode=payload.session.mode||"practice";
 sessionItems=payload.items||[];
 exercises=sessionItems.map(x=>x.exercise);
 correctToday=new Set(sessionItems.filter(x=>x.completed||x.correct).map(x=>x.position));
 index=Math.max(0,Math.min(payload.session.current_index||0,Math.max(0,exercises.length-1)));
 $("dayTitle").textContent=title||payload.session.title||"Practice";
 $("dayMeta").textContent=meta||("Saved session • "+exercises.length+" questions");
 $("report").classList.add("hidden");
 render();
}

async function startGroupSession(groupId,options={}){
 const payload=await post("/api/practice-groups/"+groupId+"/start",{});
 activateView("today");
 applySession(payload,options);
 return payload;
}

async function ensureSession(){
 if(currentSessionId) return currentSessionId;
 if(!currentGroupId) throw new Error("This practice set is not available as a saved group.");
 const oldIndex=index;
 const payload=await post("/api/practice-groups/"+currentGroupId+"/start",{});
 currentSessionId=payload.session.id;
 currentPracticeMode=payload.session.mode||currentPracticeMode;
 sessionItems=payload.items||[];
 exercises=sessionItems.map(x=>x.exercise);
 correctToday=new Set();
 index=Math.min(oldIndex,Math.max(0,exercises.length-1));
 if(index) await patch("/api/sessions/"+currentSessionId,{currentIndex:index});
 return currentSessionId;
}

async function saveCurrentItem(extra={}){
 if(!exercises.length) return;
 await ensureSession();
 const state=sessionItemAt(index);
 const body={
  answer:extra.answer===undefined?$("answer").value:extra.answer,
  hintLevel:extra.hintLevel===undefined?(state?.hint_level||hintLevel):extra.hintLevel,
  modelViewed:extra.modelViewed===undefined?Boolean(state?.model_viewed||modelViewed):extra.modelViewed
 };
 await patch("/api/sessions/"+currentSessionId+"/items/"+index,body);
 if(state){
  state.answer=body.answer;
  state.hint_level=body.hintLevel;
  state.model_viewed=body.modelViewed?1:0;
 }
}

async function loadToday(){
 const d=await get("/api/today");
 mastery=d.mastery;
 currentGroupId=d.groupId||null;
 currentSessionId=null;
 currentPracticeMode="today";
 sessionItems=[];
 exercises=d.exercises;
 index=0;
 correctToday=new Set();
 $("dayTitle").textContent="Today's Practice";
 $("dayMeta").textContent="Stage "+d.stage+" • "+d.date+" • "+exercises.length+" exercises • "+(d.generated?"AI-generated & saved":"starter set");
 if(currentGroupId){
  try{
   const active=await get("/api/practice-groups/"+currentGroupId+"/active-session");
   if(active.session){
    applySession(active,{title:"Today's Practice",meta:"Resumed saved session • "+active.items.length+" questions"});
    return;
   }
  }catch(e){console.warn(e);}
 }
 render();
}

async function generate(mode,skillId="",force=false){
 return post("/api/generate",{mode,skillId,force});
}

async function loadPlan(){
 const d=await get("/api/plan"),groups={};
 d.skills.forEach(s=>(groups[s.stage]??=[]).push(s));
 $("planList").innerHTML=Object.entries(groups).map(([stage,items])=>{
  const stable=items.filter(s=>s.status==="Stable"||s.status==="Mastered").length;
  return '<div class="plan-stage '+(Number(stage)===d.currentStage?'current':'')+'">'+
   '<div class="stage-head"><h3>Stage '+stage+(Number(stage)===d.currentStage?' • CURRENT':'')+'</h3><span class="muted">'+stable+' / '+items.length+' stable+</span></div>'+
   items.map(s=>'<div class="plan-skill"><div><b>'+esc(s.name)+'</b><small>'+esc(s.description)+' • '+esc(s.status)+' • '+s.score+'% • independent '+s.independentCorrect+' / assisted '+s.assistedCorrect+'</small></div><button data-skill="'+s.id+'">Practice</button></div>').join("")+
   '</div>';
 }).join("");
 document.querySelectorAll("[data-skill]").forEach(b=>b.onclick=()=>startSkill(b.dataset.skill));
}

async function startSkill(id){
 const b=document.querySelector('[data-skill="'+id+'"]');
 if(b){b.disabled=true;b.textContent="Generating...";}
 try{
  const d=await generate("skill",id,true);
  if(!d.groupId) throw new Error("Generated set was not saved.");
  await startGroupSession(d.groupId,{title:"Skill Practice",meta:"Focused practice • "+id+" • "+d.exercises.length+" new questions"});
 }catch(e){
  alert("Could not generate practice: "+e.message);
 }finally{
  if(b){b.disabled=false;b.textContent="Practice";}
 }
}

async function check(){
 const answer=$("answer").value.trim();
 if(!answer) return;
 const q=exercises[index];
 $("loading").classList.remove("hidden");
 $("checkBtn").disabled=true;
 try{
  await ensureSession();
  const state=sessionItemAt(index);
  const r=await fetch("/api/check",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
   exerciseId:q.id,prompt:q.prompt,answer,grammarFocus:q.focus,modelAnswer:q.model,skillId:q.skill,exerciseType:q.type,
   sessionId:currentSessionId,position:index,hintLevel:state?.hint_level||hintLevel,modelViewed:Boolean(state?.model_viewed||modelViewed)
  })});
  const d=await r.json();
  if(!r.ok) throw new Error(d.error);
  const local=sessionItemAt(index);
  if(local){
   local.answer=answer;
   local.correct=d.correct?1:local.correct;
   local.completed=d.correct?1:local.completed;
   local.attempt_count=(local.attempt_count||0)+1;
   local.feedback=d;
  }
  if(d.correct) correctToday.add(index);
  showFeedback(d);
  $("score").textContent="Completed "+correctToday.size+" / "+exercises.length;
  if(correctToday.size===exercises.length){
   if(currentPracticeMode==="today") await fetch("/api/complete-day",{method:"POST"});
   const payload=await get("/api/sessions/"+currentSessionId);
   showSessionReport(payload);
  }
 }catch(e){
  $("result").className="result bad";
  $("result").textContent=e.message;
 }finally{
  $("loading").classList.add("hidden");
  $("checkBtn").disabled=false;
 }
}

function showSessionReport(payload){
 const s=payload.session;
 const accuracy=s.total_items?Math.round((s.correct_count||0)/s.total_items*100):0;
 const first=s.total_items?Math.round((s.first_try_correct||0)/s.total_items*100):0;
 const independent=s.total_items?Math.round((s.independent_correct||0)/s.total_items*100):0;
 $("report").classList.remove("hidden");
 $("report").innerHTML='<h2>Practice Complete</h2><div class="summary-grid four">'+
  '<div><b>'+s.correct_count+'/'+s.total_items+'</b><span>Completed correctly</span></div>'+
  '<div><b>'+accuracy+'%</b><span>Final accuracy</span></div>'+
  '<div><b>'+first+'%</b><span>First-try accuracy</span></div>'+
  '<div><b>'+independent+'%</b><span>Independent accuracy</span></div>'+
  '</div><p class="muted">Independent means correct on the first check without hints or opening the model answer. This session is saved in Sets.</p>';
}

function attemptCard(a){
 const evidence=a.evidence_score==null?"—":Math.round(Number(a.evidence_score)*100)+"%";
 const assistance=[];
 if(Number(a.hint_level||0)>0) assistance.push("Hint "+a.hint_level);
 if(Number(a.model_viewed||0)===1) assistance.push("Model viewed");
 if(Number(a.first_try||0)===1) assistance.push("First try");
 return '<div class="attempt-card" data-attempt-id="'+a.id+'">'+
  '<div class="attempt-summary"><div><b>'+(a.correct?"✓ ":"△ ")+esc(a.answer||"")+'</b><small>'+esc(a.session_date||a.created_at||"")+' • '+esc(a.skill_id||"legacy")+(a.error_tag&&a.error_tag!=="none"?' • '+esc(a.error_tag):'')+'</small></div>'+
  '<button data-history-toggle="'+a.id+'">Details</button></div>'+
  '<div class="attempt-detail hidden">'+
   '<p><b>Prompt:</b> '+esc(a.prompt||"")+'</p>'+
   '<p><b>Feedback:</b> '+esc(a.feedback||"")+'</p>'+
   '<p><b>Suggestion:</b> '+esc(a.suggestion||"")+'</p>'+
   '<p><b>Better sentence:</b> '+esc(a.better_sentence||"")+'</p>'+
   '<p class="muted">Evidence '+evidence+(assistance.length?' • '+esc(assistance.join(" • ")):'')+'</p>'+
  '</div></div>';
}

async function loadProgress(){
 const d=await get("/api/progress");
 const p=d.stageProgress||{};
 $("stageText").innerHTML='Current curriculum stage: <b>'+d.stage+'</b> • Completed sessions: <b>'+(d.sessions?.completed||0)+'</b> / '+(d.sessions?.total||0);

 $("progressSummary").innerHTML=
  '<div class="dash-card"><span>Last 7 days</span><b>'+d.last7.questions+'</b><small>questions attempted</small></div>'+
  '<div class="dash-card"><span>7-day independent</span><b>'+d.last7.independentRate+'%</b><small>without hints or model answer</small></div>'+
  '<div class="dash-card"><span>Last 30 days</span><b>'+d.last30.questions+'</b><small>questions attempted</small></div>'+
  '<div class="dash-card"><span>30-day errors</span><b>'+d.last30.errors+'</b><small>recorded error checks</small></div>'+
  '<div class="dash-card"><span>Hints · 30 days</span><b>'+d.last30.hintUsed+'</b><small>questions using hints</small></div>'+
  '<div class="dash-card"><span>Model answers · 30 days</span><b>'+d.last30.modelViewed+'</b><small>questions opened</small></div>';

 $("stageProgress").innerHTML=
  '<div class="stage-progress-head"><div><b>Stage '+p.stage+'</b><div class="muted">'+p.stable+' / '+p.total+' skills at 75%+</div></div><strong>'+p.percent+'%</strong></div>'+
  '<div class="stage-meter"><i style="width:'+p.percent+'%"></i></div>'+
  (p.blockers?.length?'<h3>Skills still blocking the next stage</h3><div class="blocker-list">'+p.blockers.map(x=>'<button class="blocker" data-skill-detail="'+x.id+'">'+esc(x.name)+' · '+x.score+'% · '+x.attempts+'/2 evidence</button>').join("")+'</div>':'<p class="result ok">Stage requirements are currently satisfied.</p>');

 if(d.trend?.length){
  const max=Math.max(...d.trend.map(x=>Number(x.checks||0)),1);
  $("trendList").innerHTML=d.trend.map(x=>{
   const width=Math.max(4,Math.round(Number(x.checks||0)/max*100));
   return '<div class="trend-row"><span>'+esc(x.date)+'</span><div class="trend-track"><i style="width:'+width+'%"></i></div><small>'+x.checks+' checks • '+x.correct+' correct • '+x.independent_correct+' independent • '+x.errors+' errors</small></div>';
  }).join("");
 }else $("trendList").innerHTML='<p class="muted">No recent practice data yet.</p>';

 $("recentSessionsList").innerHTML=d.recentSessions?.length?d.recentSessions.map(s=>{
  const score=s.total_items?Math.round(Number(s.correct_count||0)/Number(s.total_items)*100):0;
  const first=s.total_items?Math.round(Number(s.first_try_correct||0)/Number(s.total_items)*100):0;
  const independent=s.total_items?Math.round(Number(s.independent_correct||0)/Number(s.total_items)*100):0;
  return '<div class="session-row"><div><b>'+esc(s.title)+'</b><small>'+esc(s.mode)+' • '+esc((s.started_at||"").replace("T"," ").slice(0,16))+' • '+esc(s.status)+'</small></div><span>'+score+'% final • '+first+'% first try • '+independent+'% independent</span></div>';
 }).join(""):'<p class="muted">No saved sessions yet.</p>';

 $("errorList").innerHTML=d.errors?.length?d.errors.map(x=>'<button class="error-chip" data-error-tag="'+esc(x.error)+'"><b>'+esc(x.error.replaceAll("_"," "))+'</b><span>'+x.count+'</span></button>').join(""):'<p class="muted">No recurring errors recorded in the last 30 days.</p>';
 $("errorDetail").className="drilldown hidden";

 $("skillList").innerHTML=d.mastery.map(s=>'<button class="skill-row skill-button" data-skill-detail="'+s.id+'"><div><b>'+esc(s.name)+'</b><small>Stage '+s.stage+' • '+esc(s.status)+' • independent '+s.independentCorrect+' • assisted '+s.assistedCorrect+'</small></div><div class="skillbar"><i style="width:'+s.score+'%"></i></div><strong>'+s.score+'%</strong></button>').join("");
 $("skillDetail").className="drilldown hidden";
}

async function showErrorDetail(tag){
 const box=$("errorDetail");
 box.className="drilldown";
 box.innerHTML='<p class="muted">Loading '+esc(tag.replaceAll("_"," "))+'…</p>';
 try{
  const d=await get("/api/errors/"+encodeURIComponent(tag)+"?days=30");
  box.innerHTML='<div class="drill-head"><div><h3>'+esc(tag.replaceAll("_"," "))+'</h3><p class="muted">'+d.count+' records in the last '+d.days+' days'+(d.bySkill?.length?' • '+d.bySkill.map(x=>esc(x.skill_id)+" "+x.count).join(", "):'')+'</p></div><button data-close-drill="error">Close</button></div>'+
   (d.attempts.length?d.attempts.map(attemptCard).join(""):'<p class="muted">No matching attempts.</p>');
 }catch(e){box.innerHTML='<div class="result bad">'+esc(e.message)+'</div>';}
}

async function showSkillDetail(id){
 const box=$("skillDetail");
 box.className="drilldown";
 box.innerHTML='<p class="muted">Loading skill details…</p>';
 try{
  const d=await get("/api/skills/"+encodeURIComponent(id));
  const s=d.skill;
  box.innerHTML='<div class="drill-head"><div><h3>'+esc(s.name)+'</h3><p class="muted">'+esc(s.description)+' • '+esc(s.status)+' • '+s.score+'% mastery • '+s.attempts+' recent evidence records</p></div><div class="actions compact"><button data-skill-practice="'+s.id+'" class="primary">Practice this skill</button><button data-close-drill="skill">Close</button></div></div>'+
   (d.errors?.length?'<p><b>Error patterns:</b> '+d.errors.map(x=>esc(x.error)+" ("+x.count+")").join(", ")+'</p>':'<p class="muted">No categorized errors for this skill.</p>')+
   '<h4>Recent evidence</h4>'+(d.attempts.length?d.attempts.map(attemptCard).join(""):'<p class="muted">No attempts yet.</p>');
 }catch(e){box.innerHTML='<div class="result bad">'+esc(e.message)+'</div>';}
}

async function loadReview(){
 const d=await get("/api/review");
 $("reviewList").innerHTML=d.reviews.length?d.reviews.map(r=>'<div class="history-row"><b>'+esc(r.skill_id)+'</b><span>Due '+esc(r.due_date)+' • last issue: '+esc(r.last_error||"practice")+'</span></div>').join(""):'<p class="muted">No reviews are due today.</p>';
}

async function loadSets(){
 const d=await get("/api/practice-groups");
 $("setsList").innerHTML=d.groups.length?d.groups.map(g=>
  '<div class="set-card" data-set-id="'+g.id+'">'+
   '<div class="set-main"><div><div class="set-title">'+(g.favorite?'★ ':'')+esc(g.title)+'</div><small>'+esc(g.mode)+' • '+g.exercise_count+' questions • '+esc((g.created_at||"").replace("T"," ").slice(0,16))+(g.session_count?' • '+g.session_count+' sessions':'')+(g.last_score!=null?' • last '+g.last_score+'%':'')+'</small></div>'+
   '<div class="set-actions"><button data-set-action="practice">Practice Again</button><button data-set-action="view">View</button><button data-set-action="favorite">'+(g.favorite?'Unfavorite':'Favorite')+'</button><button data-set-action="rename">Rename</button><button data-set-action="delete">Delete</button></div></div>'+
   '<div class="set-detail hidden" id="set-detail-'+g.id+'"></div>'+
  '</div>'
 ).join(""):'<p class="muted">No saved practice sets yet.</p>';
}

async function handleSetAction(button){
 const card=button.closest("[data-set-id]"),id=Number(card.dataset.setId),action=button.dataset.setAction;
 try{
  if(action==="practice"){
   button.disabled=true;button.textContent="Opening...";
   const payload=await post("/api/practice-groups/"+id+"/start",{});
   activateView("today");
   applySession(payload,{title:payload.session.title,meta:"Saved set replay • "+payload.items.length+" questions • no new AI generation"});
  }else if(action==="view"){
   const detail=$("set-detail-"+id);
   if(!detail.classList.contains("hidden")){detail.classList.add("hidden");return;}
   const d=await get("/api/practice-groups/"+id);
   detail.innerHTML='<ol>'+d.exercises.map(q=>'<li><b>'+esc(q.prompt)+'</b><br><small>'+esc(q.skill)+' • '+esc(q.focus||"")+'</small></li>').join("")+'</ol>';
   detail.classList.remove("hidden");
  }else if(action==="favorite"){
   const g=await get("/api/practice-groups/"+id);
   await patch("/api/practice-groups/"+id,{favorite:!g.group.favorite});
   await loadSets();
  }else if(action==="rename"){
   const g=await get("/api/practice-groups/"+id);
   const title=prompt("Rename practice set:",g.group.title);
   if(title&&title.trim()){await patch("/api/practice-groups/"+id,{title:title.trim()});await loadSets();}
  }else if(action==="delete"){
   if(!confirm("Delete this saved practice set? Practice attempts in History will remain.")) return;
   const r=await fetch("/api/practice-groups/"+id,{method:"DELETE"});
   const d=await r.json();
   if(!r.ok) throw new Error(d.error||"Delete failed");
   await loadSets();
  }
 }catch(e){alert(e.message);}
 finally{if(button&&button.isConnected){button.disabled=false;if(action==="practice")button.textContent="Practice Again";}}
}

async function loadHistory(){
 const skill=$("historySkill").value;
 const error=$("historyError").value;
 const result=$("historyResult").value;
 const days=$("historyDays").value;
 const qs=new URLSearchParams({days,result});
 if(skill) qs.set("skill",skill);
 if(error) qs.set("error",error);
 const d=await get("/api/history?"+qs.toString());

 const oldSkill=skill,oldError=error;
 $("historySkill").innerHTML='<option value="">All skills</option>'+d.options.skills.map(x=>'<option value="'+esc(x)+'">'+esc(x.replaceAll("_"," "))+'</option>').join("");
 $("historyError").innerHTML='<option value="">All errors</option>'+d.options.errors.map(x=>'<option value="'+esc(x)+'">'+esc(x.replaceAll("_"," "))+'</option>').join("");
 if(d.options.skills.includes(oldSkill)) $("historySkill").value=oldSkill;
 if(d.options.errors.includes(oldError)) $("historyError").value=oldError;
 $("historyResult").value=result;
 $("historyDays").value=days;

 $("historyCount").textContent=d.attempts.length+" checks shown";
 $("historyList").innerHTML=d.attempts.length?d.attempts.map(attemptCard).join(""):'<p class="muted">No practice history matches these filters.</p>';
}

async function loadSettings(){
 const d=await get("/api/settings");
 $("practiceCount").value=d.practiceCount;
 $("practiceCount").min=d.minPracticeCount;
 $("practiceCount").max=d.maxPracticeCount;
}

async function saveSettings(){
 const count=Number($("practiceCount").value),status=$("settingsStatus");
 $("saveSettings").disabled=true;
 try{
  const d=await post("/api/settings",{practiceCount:count});
  status.className="notice";
  status.textContent="Saved. New practice sessions will use "+d.practiceCount+" exercises.";
  await loadToday();
 }catch(e){
  status.className="result bad";status.textContent=e.message;
 }finally{$("saveSettings").disabled=false;}
}

$("errorList").onclick=e=>{const b=e.target.closest("[data-error-tag]");if(b)showErrorDetail(b.dataset.errorTag);};
$("skillList").onclick=e=>{const b=e.target.closest("[data-skill-detail]");if(b)showSkillDetail(b.dataset.skillDetail);};
$("stageProgress").onclick=e=>{const b=e.target.closest("[data-skill-detail]");if(b)showSkillDetail(b.dataset.skillDetail);};
function toggleAttemptDetail(target){
 const button=target.closest("[data-history-toggle]");
 if(!button) return false;
 const card=button.closest(".attempt-card");
 const detail=card?.querySelector(".attempt-detail");
 if(detail) detail.classList.toggle("hidden");
 return true;
}
$("errorDetail").onclick=e=>{
 toggleAttemptDetail(e.target);
 if(e.target.closest('[data-close-drill="error"]')) $("errorDetail").className="drilldown hidden";
};
$("skillDetail").onclick=e=>{
 toggleAttemptDetail(e.target);
 const practice=e.target.closest("[data-skill-practice]");if(practice)startSkill(practice.dataset.skillPractice);
 if(e.target.closest('[data-close-drill="skill"]')) $("skillDetail").className="drilldown hidden";
};
$("historyList").onclick=e=>{toggleAttemptDetail(e.target);};
["historyDays","historySkill","historyError","historyResult"].forEach(id=>$(id).addEventListener("change",()=>loadHistory().catch(e=>alert(e.message))));

document.querySelectorAll(".tab").forEach(b=>b.onclick=async()=>{
 activateView(b.dataset.view);
 if(b.dataset.view==="today") await loadToday();
 if(b.dataset.view==="plan") await loadPlan();
 if(b.dataset.view==="progress") await loadProgress();
 if(b.dataset.view==="review") await loadReview();
 if(b.dataset.view==="sets") await loadSets();
 if(b.dataset.view==="history") await loadHistory();
 if(b.dataset.view==="settings") await loadSettings();
});

$("setsList").onclick=e=>{const b=e.target.closest("[data-set-action]");if(b)handleSetAction(b);};

$("generateToday").onclick=async()=>{
 try{
  const d=await generate("today","",false);
  if(!d.groupId) throw new Error("Generated set was not saved.");
  await startGroupSession(d.groupId,{title:"Today's Practice",meta:"AI-generated & saved • "+d.exercises.length+" questions"});
 }catch(e){alert(e.message);}
};

$("regenerateToday").onclick=async()=>{
 if(!confirm("Generate a new Today set? The current set will remain saved in Sets.")) return;
 try{
  const d=await generate("today","",true);
  if(!d.groupId) throw new Error("Generated set was not saved.");
  await startGroupSession(d.groupId,{title:"Today's Practice",meta:"New AI-generated set • saved permanently • "+d.exercises.length+" questions"});
 }catch(e){alert(e.message);}
};

$("generateReview").onclick=async()=>{
 try{
  const d=await generate("review","",true);
  if(!d.groupId) throw new Error("Generated review was not saved.");
  await startGroupSession(d.groupId,{title:"Review Practice",meta:"Generated from due skills • saved permanently • "+d.exercises.length+" questions"});
 }catch(e){alert(e.message);}
};

$("saveSettings").onclick=saveSettings;

$("checkBtn").onclick=check;
$("hintBtn").onclick=async()=>{
 if(!exercises.length) return;
 hintLevel=Math.min(3,hintLevel+1);
 try{
  await ensureSession();
  const state=sessionItemAt(index);
  state.hint_level=Math.max(state.hint_level||0,hintLevel);
  await saveCurrentItem({hintLevel:state.hint_level});
  $("hint").classList.remove("hidden");
  $("hint").innerHTML="<b>Hint "+state.hint_level+":</b> "+esc(exercises[index].hints?.[state.hint_level-1]||"");
 }catch(e){alert(e.message);}
};

$("modelBtn").onclick=async()=>{
 if(!exercises.length) return;
 try{
  await ensureSession();
  modelViewed=true;
  const state=sessionItemAt(index);
  state.model_viewed=1;
  await saveCurrentItem({modelViewed:true});
  $("model").classList.remove("hidden");
  $("model").innerHTML='<b>One model answer:</b> '+esc(exercises[index].model)+'<br><span class="muted">Other natural answers can also be correct.</span>';
 }catch(e){alert(e.message);}
};

$("clearBtn").onclick=async()=>{
 $("answer").value="";
 $("answer").focus();
 try{if(currentSessionId)await saveCurrentItem({answer:""});}catch(e){console.warn(e);}
};

$("prevBtn").onclick=async()=>{
 if(index>0){
  try{await saveCurrentItem();index--;if(currentSessionId)await patch("/api/sessions/"+currentSessionId,{currentIndex:index});render();}catch(e){alert(e.message);}
 }
};

$("nextBtn").onclick=async()=>{
 if(index<exercises.length-1){
  try{await saveCurrentItem();index++;if(currentSessionId)await patch("/api/sessions/"+currentSessionId,{currentIndex:index});render();}catch(e){alert(e.message);}
 }else if(currentSessionId){
  try{showSessionReport(await get("/api/sessions/"+currentSessionId));}catch(e){alert(e.message);}
 }
};

$("answer").addEventListener("input",()=>{
 clearTimeout(answerSaveTimer);
 answerSaveTimer=setTimeout(async()=>{try{await saveCurrentItem({answer:$("answer").value});}catch(e){console.warn(e);}},700);
});

$("answer").addEventListener("keydown",e=>{
 if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();check();}
});

loadToday().catch(e=>{$("prompt").textContent="Could not load today's practice: "+e.message;});
