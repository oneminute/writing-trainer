import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import Database from "better-sqlite3";

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"writing-trainer-smoke-"));
const port=54000+(process.pid%1000);
const base="http://127.0.0.1:"+port;

const child=spawn(process.execPath,["server.js"],{
 cwd:process.cwd(),
 env:{...process.env,HOST:"127.0.0.1",PORT:String(port),DATA_DIR:tmp,LLM_PROVIDER:"ollama"},
 stdio:["ignore","pipe","pipe"]
});

let stderr="";
child.stderr.on("data",d=>{stderr+=d.toString();});

async function waitForServer(){
 for(let i=0;i<40;i++){
  try{
   const r=await fetch(base+"/api/settings");
   if(r.ok) return;
  }catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 throw new Error("Server did not become ready. "+stderr);
}

async function json(url,options){
 const r=await fetch(base+url,options);
 const text=await r.text();
 let data={};
 try{data=text?JSON.parse(text):{};}catch{throw new Error(url+" returned non-JSON: "+text.slice(0,200));}
 if(!r.ok) throw new Error(url+" failed "+r.status+": "+JSON.stringify(data));
 return data;
}

function assert(condition,message){
 if(!condition) throw new Error(message);
}

try{
 await waitForServer();

 let d=await json("/api/settings");
 assert(d.practiceCount===12,"default practiceCount should be 12");

 d=await json("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({practiceCount:8})});
 assert(d.practiceCount===8,"practiceCount save failed");

 const today=await json("/api/today");
 assert(Array.isArray(today.exercises)&&today.exercises.length===8,"Today should expose 8 starter exercises");
 assert(today.exercises.every(q=>q.planMeta&&q.planMeta.stage&&q.planMeta.lessonTitle&&q.planMeta.skillName),"Every Today exercise should expose curriculum metadata");
 assert(today.groupId,"Today should have a saved practice group");

 const plan=await json("/api/plan");
 assert(plan.curriculumVersion>=2,"Curriculum version missing");
 assert(Array.isArray(plan.stages)&&plan.stages.length===12,"Detailed 12-stage plan missing");
 const planLessons=plan.stages.flatMap(s=>s.lessons||[]);
 assert(planLessons.length>=40,"Detailed lesson plan is too small");
 assert(planLessons.every(x=>Array.isArray(x.rules)&&Array.isArray(x.commonErrors)&&Array.isArray(x.promptPatterns)),"Lesson guidance fields missing");

 const progress=await json("/api/progress");
 assert(progress.stageProgress&&typeof progress.stageProgress.percent==="number","Progress dashboard missing stageProgress");

 const history=await json("/api/history?days=0");
 assert(Array.isArray(history.attempts)&&history.options,"History API invalid");

 const groups=await json("/api/practice-groups");
 assert(Array.isArray(groups.groups)&&groups.groups.length>0,"Saved practice groups missing");

 const session=await json("/api/practice-groups/"+today.groupId+"/start",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
 assert(session.session&&session.items.length===8,"Session creation failed");
 assert(session.items.every(x=>x.exercise.planMeta&&x.exercise.planMeta.lessonTitle),"Saved-session exercises should expose curriculum metadata");

 await json("/api/sessions/"+session.session.id+"/items/0",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({answer:"test draft",hintLevel:1})});
 const resumed=await json("/api/sessions/"+session.session.id);
 assert(resumed.items[0].answer==="test draft","Session answer persistence failed");
 assert(resumed.items[0].hint_level===1,"Session hint persistence failed");

 const active=await json("/api/practice-groups/"+today.groupId+"/active-session");
 assert(active.session&&active.session.id===session.session.id,"Active session resume lookup failed");

 const q=session.items[1].exercise;
 const shortCheck=await json("/api/check",{
  method:"POST",
  headers:{"Content-Type":"application/json"},
  body:JSON.stringify({
   exerciseId:q.id,
   prompt:q.prompt,
   answer:"ki",
   grammarFocus:q.focus,
   modelAnswer:q.model,
   skillId:q.skill,
   lessonId:q.lessonId||"",
   exerciseType:q.type,
   sessionId:session.session.id,
   position:1,
   hintLevel:0,
   modelViewed:false
  })
 });
 assert(shortCheck.correct===false,"Nonsense short answer must be rejected before AI grading");
 assert(shortCheck.deterministicPrecheck===true,"Short-answer rejection should come from deterministic precheck");
 assert(shortCheck.errorTag==="incomplete_sentence","Short-answer error tag should be incomplete_sentence");

 const testDb=new Database(path.join(tmp,"writing-trainer.db"));
 const yesterday=new Date(Date.now()-86400000).toLocaleDateString("en-CA");
 testDb.prepare("INSERT INTO attempts(exercise_id,prompt,answer,correct,session_date) VALUES(?,?,?,?,?)").run("smoke-old","我通常在放学后做作业。","I usually do my homework after school.",1,yesterday);
 testDb.close();
 const laterToday=await json("/api/today");
 assert(laterToday.needsGeneration===true,"Old starter set should be replaced on later practice days");
 assert(Array.isArray(laterToday.exercises)&&laterToday.exercises.length===0,"Later Today should not silently reload the starter set");

 console.log("Smoke test passed: settings, curriculum, deterministic short-answer rejection, today, progress, history, sets, session persistence.");
} finally {
 child.kill();
 await new Promise(r=>setTimeout(r,100));
 fs.rmSync(tmp,{recursive:true,force:true});
}
