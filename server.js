import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SKILLS, skillMap, statusFromMastery, nextReviewDays } from "./src/curriculum.js";
import { BASE_EXERCISES } from "./src/exercises.js";

const app = express();
const port = process.env.PORT || 5178;
const llmProvider = (process.env.LLM_PROVIDER || "ollama").toLowerCase();
const ollamaBaseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const ollamaModel = process.env.OLLAMA_WRITING_MODEL || "hf.co/unsloth/Qwen3.5-9B-GGUF:UD-Q4_K_XL";
const ollamaTimeoutMs = Number(process.env.OLLAMA_WRITING_TIMEOUT_SECONDS || 60) * 1000;
const openaiModel = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

async function checkWithOllama(input, instructions) {
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), ollamaTimeoutMs);
 try {
  const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
   method:"POST", headers:{"Content-Type":"application/json"}, signal:controller.signal,
   body:JSON.stringify({
    model:ollamaModel, stream:false, think:false, keep_alive:"10m",
    format:schema,
    options:{temperature:0},
    messages:[
     {role:"system",content:instructions + " Return ONLY valid JSON matching the requested fields."},
     {role:"user",content:input}
    ]
   })
  });
  if(!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const data=await response.json();
  return {...JSON.parse(data.message?.content || "{}"), provider:`ollama:${ollamaModel}`};
 } finally { clearTimeout(timer); }
}

async function checkWithOpenAI(input, instructions) {
 if(!client) throw new Error("OPENAI_API_KEY is not configured");
 const response=await client.responses.create({
  model:openaiModel, reasoning:{effort:"none"}, max_output_tokens:260,
  instructions, input,
  text:{format:{type:"json_schema",name:"writing_check",strict:true,schema}}
 });
 return {...JSON.parse(response.output_text),provider:`openai:${openaiModel}`};
}

async function runWritingCheck(input, instructions) {
 if(llmProvider==="ollama") return checkWithOllama(input,instructions);
 if(llmProvider==="openai") return checkWithOpenAI(input,instructions);
 if(llmProvider==="auto"){
  try { return await checkWithOllama(input,instructions); }
  catch(error){ console.warn("Ollama failed; using OpenAI fallback:",error.message); return checkWithOpenAI(input,instructions); }
 }
 throw new Error("LLM_PROVIDER must be ollama, openai, or auto");
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "writing-trainer.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS attempts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, exercise_id TEXT NOT NULL, prompt TEXT NOT NULL,
 grammar_focus TEXT, answer TEXT NOT NULL, correct INTEGER NOT NULL DEFAULT 0,
 meaning TEXT, grammar TEXT, tense TEXT, capitalization TEXT, punctuation TEXT,
 feedback TEXT, suggestion TEXT, better_sentence TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS skill_attempts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id INTEGER NOT NULL, skill_id TEXT NOT NULL,
 success INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS review_queue (
 skill_id TEXT PRIMARY KEY, due_date TEXT NOT NULL, streak INTEGER NOT NULL DEFAULT 0,
 last_error TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS daily_sessions (
 session_date TEXT PRIMARY KEY, completed INTEGER NOT NULL DEFAULT 0,
 started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT
);
`);

const cols = db.prepare("PRAGMA table_info(attempts)").all().map(x=>x.name);
for (const [name,type] of [["skill_id","TEXT"],["exercise_type","TEXT"],["session_date","TEXT"],["error_tag","TEXT"]]) {
  if (!cols.includes(name)) db.exec(`ALTER TABLE attempts ADD COLUMN ${name} ${type}`);
}
db.exec(`CREATE TABLE IF NOT EXISTS generated_sets (
 set_key TEXT PRIMARY KEY,
 mode TEXT NOT NULL,
 skill_id TEXT,
 exercises_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
const generatedSetCols=db.prepare("PRAGMA table_info(generated_sets)").all().map(x=>x.name);
if(!generatedSetCols.includes("group_id")) db.exec("ALTER TABLE generated_sets ADD COLUMN group_id INTEGER");


db.exec(`
CREATE TABLE IF NOT EXISTS practice_groups (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 mode TEXT NOT NULL,
 skill_id TEXT,
 title TEXT NOT NULL,
 exercise_count INTEGER NOT NULL,
 archive_key TEXT UNIQUE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS practice_group_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 group_id INTEGER NOT NULL,
 position INTEGER NOT NULL,
 exercise_id TEXT,
 skill_id TEXT,
 prompt TEXT NOT NULL,
 focus TEXT,
 model TEXT,
 exercise_json TEXT NOT NULL,
 FOREIGN KEY(group_id) REFERENCES practice_groups(id) ON DELETE CASCADE,
 UNIQUE(group_id, position)
);
CREATE INDEX IF NOT EXISTS idx_practice_groups_created ON practice_groups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_practice_items_group ON practice_group_items(group_id, position);
CREATE TABLE IF NOT EXISTS practice_sessions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 group_id INTEGER,
 title TEXT NOT NULL,
 mode TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'in_progress',
 current_index INTEGER NOT NULL DEFAULT 0,
 total_items INTEGER NOT NULL,
 correct_count INTEGER NOT NULL DEFAULT 0,
 first_try_correct INTEGER NOT NULL DEFAULT 0,
 started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TEXT,
 FOREIGN KEY(group_id) REFERENCES practice_groups(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS practice_session_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 session_id INTEGER NOT NULL,
 position INTEGER NOT NULL,
 exercise_id TEXT,
 skill_id TEXT,
 exercise_json TEXT NOT NULL,
 answer TEXT NOT NULL DEFAULT '',
 correct INTEGER NOT NULL DEFAULT 0,
 completed INTEGER NOT NULL DEFAULT 0,
 attempt_count INTEGER NOT NULL DEFAULT 0,
 hint_level INTEGER NOT NULL DEFAULT 0,
 model_viewed INTEGER NOT NULL DEFAULT 0,
 first_try_correct INTEGER NOT NULL DEFAULT 0,
 last_feedback_json TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE,
 UNIQUE(session_id, position)
);
CREATE INDEX IF NOT EXISTS idx_practice_sessions_group ON practice_sessions(group_id, status, id DESC);
CREATE INDEX IF NOT EXISTS idx_session_items_session ON practice_session_items(session_id, position);
`);
const groupCols=db.prepare("PRAGMA table_info(practice_groups)").all().map(x=>x.name);
if(!groupCols.includes("favorite")) db.exec("ALTER TABLE practice_groups ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");

const skillAttemptCols=db.prepare("PRAGMA table_info(skill_attempts)").all().map(x=>x.name);
for(const [name,type] of [["evidence_score","REAL"],["first_try","INTEGER"],["hint_level","INTEGER"],["model_viewed","INTEGER"]]){
 if(!skillAttemptCols.includes(name)) db.exec("ALTER TABLE skill_attempts ADD COLUMN "+name+" "+type);
}

db.exec("CREATE INDEX IF NOT EXISTS idx_skill_attempts_skill ON skill_attempts(skill_id, created_at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_attempts_date ON attempts(session_date, id)");

const today = () => new Date().toLocaleDateString("en-CA");
const addDays = n => { const d=new Date(); d.setDate(d.getDate()+n); return d.toLocaleDateString("en-CA"); };
const setState=db.prepare("INSERT INTO app_state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
const getState=db.prepare("SELECT value FROM app_state WHERE key=?");
function getPracticeCount(){
 const n=Number(getState.get("practiceCount")?.value||12);
 return Number.isInteger(n)&&n>=4&&n<=20?n:12;
}

app.use(express.json({limit:"32kb"}));
app.use(express.static(path.join(__dirname,"public")));

const schema={type:"object",additionalProperties:false,properties:{
 correct:{type:"boolean"},meaning:{type:"string",enum:["ok","needs_work"]},
 grammar:{type:"string",enum:["ok","needs_work"]},tense:{type:"string",enum:["ok","needs_work","not_applicable"]},
 capitalization:{type:"string",enum:["ok","needs_work"]},punctuation:{type:"string",enum:["ok","needs_work"]},
 feedback:{type:"string"},suggestion:{type:"string"},betterSentence:{type:"string"},
 skillSuccess:{type:"boolean"},errorTag:{type:"string"}
},required:["correct","meaning","grammar","tense","capitalization","punctuation","feedback","suggestion","betterSentence","skillSuccess","errorTag"]};

const ERROR_TAGS=[
 "none","subject_verb_agreement","verb_tense","auxiliary_base_form","article","preposition",
 "pronoun","singular_plural","word_order","clause_structure","capitalization","punctuation",
 "vocabulary","meaning","assisted_success","other"
];

function normalizeErrorTag(tag,result){
 if(result?.skillSuccess&&String(tag||"").toLowerCase()==="none") return "none";
 const raw=String(tag||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
 const map={
  tense:"verb_tense",past_tense:"verb_tense",present_tense:"verb_tense",future_tense:"verb_tense",
  subject_verb:"subject_verb_agreement",subject_verb_agreement:"subject_verb_agreement",agreement:"subject_verb_agreement",
  did_base_form:"auxiliary_base_form",auxiliary:"auxiliary_base_form",auxiliary_base_form:"auxiliary_base_form",
  articles:"article",article:"article",prepositions:"preposition",preposition:"preposition",
  pronouns:"pronoun",pronoun_case:"pronoun",pronoun:"pronoun",
  plural:"singular_plural",singular_plural:"singular_plural",
  word_order:"word_order",clause:"clause_structure",clause_structure:"clause_structure",
  capitalization:"capitalization",punctuation:"punctuation",vocabulary:"vocabulary",
  meaning:"meaning",semantic:"meaning",none:"none"
 };
 return map[raw] ? map[raw] : (ERROR_TAGS.includes(raw) ? raw : "other");
}

function masteryRows(){
 return SKILLS.map(s=>{
   const rows=db.prepare("SELECT success,evidence_score,first_try,hint_level,model_viewed FROM skill_attempts WHERE skill_id=? ORDER BY id DESC LIMIT 10").all(s.id);
   if(!rows.length) return {...s,score:0,attempts:0,status:"Not started",independentCorrect:0,assistedCorrect:0};
   const weights=rows.map((_,i)=>Math.max(1,10-i));
   const evidence=rows.map(r=>r.evidence_score==null?(r.success?1:0):Number(r.evidence_score));
   const score=Math.round(evidence.reduce((a,v,i)=>a+v*weights[i],0)/weights.reduce((a,b)=>a+b,0)*100);
   const independentCorrect=rows.filter(r=>r.success&&r.first_try===1&&(r.hint_level||0)===0&&(r.model_viewed||0)===0).length;
   const assistedCorrect=rows.filter(r=>r.success&&!((r.first_try===1)&&(r.hint_level||0)===0&&(r.model_viewed||0)===0)).length;
   return {...s,score,attempts:rows.length,status:statusFromMastery(score,rows.length),independentCorrect,assistedCorrect};
 });
}

function currentStage(mastery){
 for(let stage=1;stage<=12;stage++){
   const relevant=mastery.filter(x=>x.stage===stage);
   if(relevant.length && relevant.some(x=>x.status!=="Mastered" && x.score<75)) return stage;
 }
 return 12;
}


function exerciseSchemaFor(allowed,count,mode){
 return {
  type:"object",additionalProperties:false,
  properties:{exercises:{
   type:"array",minItems:count,maxItems:count,
   items:{type:"object",additionalProperties:false,properties:{
    id:{type:"string"},
    type:{type:"string",enum:[mode]},
    skill:{type:"string",enum:allowed},
    reviewSkills:{type:"array",items:{type:"string"}},
    prompt:{type:"string"},
    focus:{type:"string"},
    hints:{type:"array",minItems:3,maxItems:3,items:{type:"string"}},
    model:{type:"string"}
   },required:["id","type","skill","reviewSkills","prompt","focus","hints","model"]}
  }},
  required:["exercises"]
 };
}

function containsChinese(text){
 return /[\u3400-\u4dbf\u4e00-\u9fff]/u.test(String(text||""));
}

function validateGeneratedExercises(exercises,allowed,count,mode){
 if(!Array.isArray(exercises)) return "exercises is not an array";
 if(exercises.length!==count) return "expected "+count+" exercises, got "+exercises.length;
 const seen=new Set();
 for(let i=0;i<exercises.length;i++){
  const q=exercises[i]||{};
  if(!allowed.includes(q.skill)) return "exercise "+(i+1)+" used disallowed skill: "+q.skill;
  if(q.type!==mode) return "exercise "+(i+1)+" has wrong type: "+q.type;
  if(!containsChinese(q.prompt)) return "exercise "+(i+1)+" prompt is not Chinese: "+q.prompt;
  if(!String(q.model||"").trim()) return "exercise "+(i+1)+" has no model answer";
  if(!Array.isArray(q.hints)||q.hints.length!==3) return "exercise "+(i+1)+" must have exactly 3 hints";
  const key=String(q.prompt).trim();
  if(seen.has(key)) return "duplicate prompt: "+key;
  seen.add(key);
 }
 return "";
}

function todaySkillIds(mastery,stage,date){
 const due=db.prepare("SELECT skill_id FROM review_queue WHERE due_date<=? ORDER BY due_date LIMIT 2").all(date).map(x=>x.skill_id);
 const weak=mastery.filter(x=>x.attempts&&x.score<70).sort((a,b)=>a.score-b.score).slice(0,2).map(x=>x.id);
 const current=SKILLS.filter(x=>x.stage===stage).map(x=>x.id);
 const skills=[...new Set([...due,...weak,...current])];
 return skills.length?skills:SKILLS.filter(x=>x.stage<=Math.max(2,stage)).slice(0,6).map(x=>x.id);
}

function cyclePick(items,count,fallback=[]){
 const source=items.length?items:fallback;
 if(!source.length) return [];
 return Array.from({length:count},(_,i)=>source[i%source.length]);
}

function buildTodaySkillSequence(mastery,stage,date,count){
 const due=db.prepare("SELECT skill_id FROM review_queue WHERE due_date<=? ORDER BY due_date LIMIT 4").all(date).map(x=>x.skill_id).filter(x=>skillMap[x]);
 const weak=mastery.filter(x=>x.attempts&&x.score<70).sort((a,b)=>a.score-b.score).map(x=>x.id);
 const current=SKILLS.filter(x=>x.stage===stage).map(x=>x.id);
 const learned=mastery.filter(x=>x.attempts>0&&x.status!=="Not started").map(x=>x.id);
 const reviewN=Math.min(count,Math.max(1,Math.round(count*0.17)));
 const weakN=Math.min(count-reviewN,Math.max(1,Math.round(count*0.17)));
 const currentN=Math.min(count-reviewN-weakN,Math.max(1,Math.round(count*0.34)));
 const mixedN=Math.max(0,count-reviewN-weakN-currentN);
 return [
  ...cyclePick(due,reviewN,current),
  ...cyclePick(weak,weakN,current),
  ...cyclePick(current,currentN,learned),
  ...cyclePick([...new Set([...learned,...current])],mixedN,current)
 ].slice(0,count);
}

function buildSkillSequence(skills,count){
 return cyclePick([...new Set(skills.filter(x=>skillMap[x]))],count,SKILLS.slice(0,1).map(x=>x.id));
}

async function generateExercises(skills,count,mode,targetSequence=null){
 const allowed=[...new Set(skills.filter(x=>skillMap[x]))].slice(0,8);
 if(!allowed.length) throw new Error("No valid curriculum skills were selected");
 const format=exerciseSchemaFor(allowed,count,mode);
 const instructions=[
  "Create English writing exercises for an 11-year-old sixth-grade ESL student.",
  "CRITICAL: Every prompt field MUST be written in Simplified Chinese. The student sees the Chinese prompt and writes the English sentence.",
  "The model field MUST be the natural American English answer.",
  "Never put the English model answer in prompt.",
  "Use ONLY the allowed primary skill IDs.",
  "Test one primary skill per item.",
  "Give exactly 3 progressive hints.",
  "Do not duplicate prompts.",
  "Return only valid JSON matching the schema."
 ].join(" ");
 const sequence=Array.isArray(targetSequence)&&targetSequence.length===count?targetSequence:null;
 const baseInput="Mode: "+mode+". Generate exactly "+count+" exercises. Allowed primary skill IDs: "+allowed.join(", ")+". Skill descriptions: "+allowed.map(id=>id+": "+skillMap[id].description).join("; ")+(sequence?" IMPORTANT: exercise primary skills in exact order must be: "+sequence.join(", ")+".":"");

 async function callOllama(input){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),ollamaTimeoutMs);
  try{
   const response=await fetch(ollamaBaseUrl+"/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},signal:controller.signal,body:JSON.stringify({
    model:ollamaModel,stream:false,think:false,keep_alive:"10m",format,options:{temperature:0},
    messages:[{role:"system",content:instructions},{role:"user",content:input}]
   })});
   if(!response.ok) throw new Error("Ollama HTTP "+response.status);
   const data=await response.json();
   return JSON.parse(data.message?.content||"{}").exercises;
  }finally{clearTimeout(timer);}
 }

 async function callOpenAI(input){
  if(!client) throw new Error("OpenAI fallback unavailable");
  const r=await client.responses.create({model:openaiModel,reasoning:{effort:"none"},max_output_tokens:Math.min(5000,Math.max(1800,count*220)),instructions,input,text:{format:{type:"json_schema",name:"exercise_set",strict:true,schema:format}}});
  return JSON.parse(r.output_text).exercises;
 }

 let lastError="";
 for(let attempt=1;attempt<=3;attempt++){
  const retryNote=lastError?" Previous output was rejected because: "+lastError+". Correct that exact problem.":"";
  try{
   let exercises;
   if(llmProvider==="openai") exercises=await callOpenAI(baseInput+retryNote);
   else{
    try{exercises=await callOllama(baseInput+retryNote);}
    catch(e){
     if(llmProvider!=="auto") throw e;
     console.warn("Ollama generation failed; fallback:",e.message);
     exercises=await callOpenAI(baseInput+retryNote);
    }
   }
   let problem=validateGeneratedExercises(exercises,allowed,count,mode);
   if(!problem&&sequence){for(let i=0;i<count;i++){if(exercises[i]?.skill!==sequence[i]){problem="exercise "+(i+1)+" must use skill "+sequence[i]+", got "+exercises[i]?.skill;break;}}}
   if(!problem) return exercises;
   lastError=problem;
   console.warn("Rejected generated exercise set:",problem);
  }catch(e){
   lastError=e?.message||String(e);
   if(attempt===3) throw e;
  }
 }
 throw new Error("The local model could not produce a valid Chinese exercise set after 3 attempts: "+lastError);
}

function practiceGroupTitle(mode,skillId,count,date=today()){
 if(mode==="skill") return (skillMap[skillId]?.name||skillId||"Skill")+" Practice · "+date+" · "+count+" questions";
 if(mode==="review") return "Review Practice · "+date+" · "+count+" questions";
 return "Today Practice · "+date+" · "+count+" questions";
}

function archivePracticeGroup(mode,skillId,exercises,{archiveKey=null,title=null}={}){
 const run=db.transaction(()=>{
  const info=db.prepare("INSERT INTO practice_groups(mode,skill_id,title,exercise_count,archive_key) VALUES(?,?,?,?,?)").run(
   mode,skillId||null,title||practiceGroupTitle(mode,skillId,exercises.length),exercises.length,archiveKey
  );
  const groupId=Number(info.lastInsertRowid);
  const insert=db.prepare("INSERT INTO practice_group_items(group_id,position,exercise_id,skill_id,prompt,focus,model,exercise_json) VALUES(?,?,?,?,?,?,?,?)");
  exercises.forEach((q,i)=>insert.run(groupId,i,String(q.id||""),q.skill||null,String(q.prompt||""),String(q.focus||""),String(q.model||""),JSON.stringify(q)));
  return groupId;
 });
 return run();
}

function importExistingGeneratedSets(){
 const rows=db.prepare("SELECT set_key,mode,skill_id,exercises_json,created_at,group_id FROM generated_sets ORDER BY created_at").all();
 const exists=db.prepare("SELECT id FROM practice_groups WHERE archive_key=?");
 for(const row of rows){
  const archiveKey="generated_sets:"+row.set_key;
  let groupId=row.group_id||exists.get(archiveKey)?.id;
  try{
   const exercises=JSON.parse(row.exercises_json);
   if(!Array.isArray(exercises)||!exercises.length) continue;
   if(!groupId) groupId=archivePracticeGroup(row.mode,row.skill_id,exercises,{archiveKey,title:practiceGroupTitle(row.mode,row.skill_id,exercises.length,row.created_at?.slice(0,10)||today())});
   db.prepare("UPDATE generated_sets SET group_id=? WHERE set_key=?").run(groupId,row.set_key);
  }catch(e){console.warn("Could not import cached practice set",row.set_key,e.message);}
 }
 const baseKey="base:starter";
 if(!exists.get(baseKey)) archivePracticeGroup("today",null,BASE_EXERCISES,{archiveKey:baseKey,title:"Starter Practice · "+BASE_EXERCISES.length+" questions"});
}

importExistingGeneratedSets();

app.get("/api/settings",(req,res)=>{
 res.json({practiceCount:getPracticeCount(),minPracticeCount:4,maxPracticeCount:20});
});

app.post("/api/settings",(req,res)=>{
 const practiceCount=Number(req.body?.practiceCount);
 if(!Number.isInteger(practiceCount)||practiceCount<4||practiceCount>20){
  return res.status(400).json({error:"practiceCount must be an integer from 4 to 20"});
 }
 setState.run("practiceCount",String(practiceCount));
 res.json({ok:true,practiceCount});
});

app.get("/api/plan",(req,res)=>{const mastery=masteryRows();res.json({currentStage:currentStage(mastery),skills:mastery});});

app.post("/api/generate",async(req,res)=>{
 try{
  const mode=String(req.body?.mode||"today"), requestedSkill=String(req.body?.skillId||""), force=Boolean(req.body?.force);
  const mastery=masteryRows(),stage=currentStage(mastery),date=today(); let skills=[],count=getPracticeCount(),setKey="",sequence=[];
  if(mode==="skill"){
   if(!skillMap[requestedSkill]) return res.status(400).json({error:"Unknown skill"});
   skills=[requestedSkill];sequence=buildSkillSequence(skills,count);setKey="skill:"+requestedSkill+":"+date;
  }else if(mode==="review"){
   skills=db.prepare("SELECT skill_id FROM review_queue WHERE due_date<=? ORDER BY due_date LIMIT 4").all(date).map(x=>x.skill_id).filter(x=>skillMap[x]);
   if(!skills.length) return res.status(400).json({error:"No reviews are due today"});
   sequence=buildSkillSequence(skills,count);setKey="review:"+date;
  }else{
   sequence=buildTodaySkillSequence(mastery,stage,date,count);
   skills=[...new Set(sequence)];setKey="today:"+date;
  }
  if(!force){
   const cached=db.prepare("SELECT exercises_json,group_id FROM generated_sets WHERE set_key=?").get(setKey);
   if(cached){
    const parsed=JSON.parse(cached.exercises_json);
    let problem=validateGeneratedExercises(parsed,skills,count,mode);
    if(!problem&&sequence.length===count){for(let i=0;i<count;i++){if(parsed[i]?.skill!==sequence[i]){problem="planner sequence changed";break;}}}
    if(!problem) return res.json({cached:true,mode,groupId:cached.group_id||null,exercises:parsed});
    db.prepare("DELETE FROM generated_sets WHERE set_key=?").run(setKey);
    console.warn("Discarded invalid cached set:",setKey,problem);
   }
  }
  const exercises=await generateExercises(skills,count,mode,sequence);
  const groupId=archivePracticeGroup(mode,requestedSkill||null,exercises);
  db.prepare("INSERT INTO generated_sets(set_key,mode,skill_id,exercises_json,group_id) VALUES(?,?,?,?,?) ON CONFLICT(set_key) DO UPDATE SET exercises_json=excluded.exercises_json,skill_id=excluded.skill_id,group_id=excluded.group_id,created_at=CURRENT_TIMESTAMP").run(setKey,mode,requestedSkill||null,JSON.stringify(exercises),groupId);
  res.json({cached:false,mode,groupId,exercises});
 }catch(e){console.error(e);res.status(500).json({error:e?.message||"Generation failed"});}
});

app.get("/api/today",(req,res)=>{
 const date=today();
 db.prepare("INSERT OR IGNORE INTO daily_sessions(session_date) VALUES (?)").run(date);
 const mastery=masteryRows();
 const stage=currentStage(mastery);
 const practiceCount=getPracticeCount();
 const due=db.prepare("SELECT * FROM review_queue WHERE due_date<=? ORDER BY due_date LIMIT 4").all(date);
 const sequence=buildTodaySkillSequence(mastery,stage,date,practiceCount);
 const allowed=[...new Set(sequence)];
 let generated=false,groupId=null;
 let exercises=BASE_EXERCISES.slice(0,Math.min(practiceCount,BASE_EXERCISES.length));
 const baseGroup=db.prepare("SELECT id FROM practice_groups WHERE archive_key='base:starter'").get();
 groupId=baseGroup?.id||null;
 const cached=db.prepare("SELECT exercises_json,group_id FROM generated_sets WHERE set_key=?").get("today:"+date);
 if(cached){
  const parsed=JSON.parse(cached.exercises_json);
  let problem=validateGeneratedExercises(parsed,allowed,practiceCount,"today");
  if(!problem){for(let i=0;i<practiceCount;i++){if(parsed[i]?.skill!==sequence[i]){problem="planner sequence changed";break;}}}
  if(!problem){exercises=parsed;generated=true;groupId=cached.group_id||null;}
  else{db.prepare("DELETE FROM generated_sets WHERE set_key=?").run("today:"+date);console.warn("Discarded invalid today cache:",problem);}
 }
 res.json({date,stage,practiceCount,groupId,exercises,dueReviews:due,mastery,generated});
});

app.get("/api/progress",(req,res)=>{
 const mastery=masteryRows();
 const totals=db.prepare("SELECT COUNT(*) attempts, SUM(correct) correct FROM attempts").get();
 const sessions=db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed FROM practice_sessions").get();
 const errors=db.prepare("SELECT last_error error,COUNT(*) count FROM review_queue WHERE last_error IS NOT NULL GROUP BY last_error ORDER BY count DESC LIMIT 8").all();
 res.json({mastery,stage:currentStage(mastery),totals,sessions,errors});
});

app.get("/api/practice-groups",(req,res)=>{
 const groups=db.prepare(`SELECT g.id,g.mode,g.skill_id,g.title,g.exercise_count,g.favorite,g.created_at,
  (SELECT COUNT(*) FROM practice_sessions s WHERE s.group_id=g.id) session_count,
  (SELECT ROUND(100.0*s.correct_count/NULLIF(s.total_items,0)) FROM practice_sessions s WHERE s.group_id=g.id AND s.status='completed' ORDER BY s.id DESC LIMIT 1) last_score
  FROM practice_groups g ORDER BY g.favorite DESC,g.id DESC LIMIT 300`).all();
 res.json({groups:groups.map(g=>({...g,skillName:g.skill_id?(skillMap[g.skill_id]?.name||g.skill_id):null}))});
});

app.get("/api/practice-groups/:id",(req,res)=>{
 const id=Number(req.params.id);
 if(!Number.isInteger(id)||id<1) return res.status(400).json({error:"Invalid practice group id"});
 const group=db.prepare("SELECT id,mode,skill_id,title,exercise_count,favorite,created_at FROM practice_groups WHERE id=?").get(id);
 if(!group) return res.status(404).json({error:"Practice group not found"});
 const items=db.prepare("SELECT exercise_json FROM practice_group_items WHERE group_id=? ORDER BY position").all(id);
 res.json({group:{...group,skillName:group.skill_id?(skillMap[group.skill_id]?.name||group.skill_id):null},exercises:items.map(x=>JSON.parse(x.exercise_json))});
});

app.patch("/api/practice-groups/:id",(req,res)=>{
 const id=Number(req.params.id);
 const group=db.prepare("SELECT * FROM practice_groups WHERE id=?").get(id);
 if(!group) return res.status(404).json({error:"Practice group not found"});
 const title=req.body?.title===undefined?group.title:String(req.body.title).trim();
 const favorite=req.body?.favorite===undefined?group.favorite:(req.body.favorite?1:0);
 if(!title) return res.status(400).json({error:"Title cannot be empty"});
 db.prepare("UPDATE practice_groups SET title=?,favorite=? WHERE id=?").run(title,favorite,id);
 res.json({ok:true,id,title,favorite});
});

app.delete("/api/practice-groups/:id",(req,res)=>{
 const id=Number(req.params.id);
 db.prepare("DELETE FROM generated_sets WHERE group_id=?").run(id);
 const info=db.prepare("DELETE FROM practice_groups WHERE id=?").run(id);
 if(!info.changes) return res.status(404).json({error:"Practice group not found"});
 res.json({ok:true});
});

function createPracticeSession(groupId){
 const group=db.prepare("SELECT id,title,mode,exercise_count FROM practice_groups WHERE id=?").get(groupId);
 if(!group) throw new Error("Practice group not found");
 const rows=db.prepare("SELECT position,exercise_id,skill_id,exercise_json FROM practice_group_items WHERE group_id=? ORDER BY position").all(groupId);
 const run=db.transaction(()=>{
  const info=db.prepare("INSERT INTO practice_sessions(group_id,title,mode,total_items) VALUES(?,?,?,?)").run(group.id,group.title,group.mode,rows.length);
  const sessionId=Number(info.lastInsertRowid);
  const ins=db.prepare("INSERT INTO practice_session_items(session_id,position,exercise_id,skill_id,exercise_json) VALUES(?,?,?,?,?)");
  rows.forEach(r=>ins.run(sessionId,r.position,r.exercise_id,r.skill_id,r.exercise_json));
  return sessionId;
 });
 return run();
}

function sessionPayload(id){
 const session=db.prepare("SELECT * FROM practice_sessions WHERE id=?").get(id);
 if(!session) return null;
 const items=db.prepare("SELECT position,exercise_json,answer,correct,completed,attempt_count,hint_level,model_viewed,first_try_correct,last_feedback_json FROM practice_session_items WHERE session_id=? ORDER BY position").all(id)
  .map(r=>({...r,exercise:JSON.parse(r.exercise_json),feedback:r.last_feedback_json?JSON.parse(r.last_feedback_json):null}));
 return {session,items};
}

app.post("/api/practice-groups/:id/start",(req,res)=>{
 try{
  const sessionId=createPracticeSession(Number(req.params.id));
  res.json(sessionPayload(sessionId));
 }catch(e){res.status(404).json({error:e.message});}
});

app.get("/api/practice-groups/:id/active-session",(req,res)=>{
 const id=Number(req.params.id);
 const row=db.prepare("SELECT id FROM practice_sessions WHERE group_id=? AND status='in_progress' ORDER BY id DESC LIMIT 1").get(id);
 res.json(row?sessionPayload(row.id):{session:null,items:[]});
});

app.get("/api/sessions/:id",(req,res)=>{
 const payload=sessionPayload(Number(req.params.id));
 if(!payload) return res.status(404).json({error:"Practice session not found"});
 res.json(payload);
});

app.patch("/api/sessions/:id",(req,res)=>{
 const id=Number(req.params.id),currentIndex=Number(req.body?.currentIndex);
 if(!Number.isInteger(currentIndex)||currentIndex<0) return res.status(400).json({error:"Invalid currentIndex"});
 const info=db.prepare("UPDATE practice_sessions SET current_index=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(currentIndex,id);
 if(!info.changes) return res.status(404).json({error:"Practice session not found"});
 res.json({ok:true});
});

app.patch("/api/sessions/:id/items/:position",(req,res)=>{
 const id=Number(req.params.id),position=Number(req.params.position);
 const row=db.prepare("SELECT * FROM practice_session_items WHERE session_id=? AND position=?").get(id,position);
 if(!row) return res.status(404).json({error:"Session item not found"});
 const answer=req.body?.answer===undefined?row.answer:String(req.body.answer);
 const hintLevel=req.body?.hintLevel===undefined?row.hint_level:Math.max(0,Math.min(3,Number(req.body.hintLevel)||0));
 const modelViewed=req.body?.modelViewed===undefined?row.model_viewed:(req.body.modelViewed?1:0);
 db.prepare("UPDATE practice_session_items SET answer=?,hint_level=?,model_viewed=?,updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND position=?").run(answer,hintLevel,modelViewed,id,position);
 db.prepare("UPDATE practice_sessions SET current_index=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(position,id);
 res.json({ok:true});
});

app.get("/api/history",(req,res)=>{
 const rows=db.prepare("SELECT id,session_date,exercise_id,exercise_type,skill_id,prompt,answer,correct,error_tag,feedback,suggestion,better_sentence,created_at FROM attempts ORDER BY id DESC LIMIT 200").all();
 res.json({attempts:rows});
});

app.get("/api/review",(req,res)=>{
 const rows=db.prepare("SELECT * FROM review_queue WHERE due_date<=? ORDER BY due_date, skill_id").all(today());
 res.json({reviews:rows});
});

app.get("/api/report",(req,res)=>{
 const date=String(req.query.date||today());
 const rows=db.prepare("SELECT * FROM attempts WHERE session_date=? ORDER BY id").all(date);
 const skillRows=db.prepare("SELECT sa.skill_id, COUNT(*) attempts, SUM(sa.success) successes FROM skill_attempts sa JOIN attempts a ON a.id=sa.attempt_id WHERE a.session_date=? GROUP BY sa.skill_id").all(date);
 const strong=skillRows.filter(x=>x.successes/x.attempts>=.8).map(x=>skillMap[x.skill_id]?.name||x.skill_id);
 const weak=skillRows.filter(x=>x.successes/x.attempts<.8).map(x=>skillMap[x.skill_id]?.name||x.skill_id);
 res.json({date,attempts:rows.length,correct:rows.filter(x=>x.correct).length,strong,weak,mistakes:rows.filter(x=>!x.correct).slice(-5).map(x=>({answer:x.answer,feedback:x.feedback,better:x.better_sentence}))});
});

app.post("/api/state",(req,res)=>{
 const n=req.body?.currentExercise;
 if(Number.isInteger(n)&&n>=0)setState.run("currentExercise",String(n));
 res.json({ok:true});
});

app.post("/api/check",async(req,res)=>{
 try{
  const {exerciseId,prompt,answer,grammarFocus,modelAnswer,skillId,exerciseType,sessionId,position,hintLevel=0,modelViewed=false}=req.body??{};
  if(exerciseId===undefined||!prompt||!answer||!skillId) return res.status(400).json({error:"exerciseId, prompt, answer and skillId are required"});
  const skill=skillMap[skillId];
  const sessionItem=(sessionId!==undefined&&position!==undefined)?db.prepare("SELECT * FROM practice_session_items WHERE session_id=? AND position=?").get(Number(sessionId),Number(position)):null;
  const previousAttempts=sessionItem?.attempt_count||0;
  const firstTry=previousAttempts===0;
  const instructions="You are a concise writing coach for an 11-year-old ESL student. Judge meaning and grammar, not exact wording. Accept natural alternatives. Evaluate the named target skill separately. Capitalization or punctuation alone must not fail grammar/meaning. errorTag should be a short stable grammar category or 'none'. Keep feedback child-friendly.";
  const input="Prompt: "+prompt+"\nTarget skill: "+(skill?.name||skillId)+"\nFocus: "+(grammarFocus||"")+"\nStudent: "+answer+"\nReference only: "+(modelAnswer||"(none)")+"\nRequired JSON keys: correct(boolean), meaning(ok|needs_work), grammar(ok|needs_work), tense(ok|needs_work|not_applicable), capitalization(ok|needs_work), punctuation(ok|needs_work), feedback(string), suggestion(string), betterSentence(string), skillSuccess(boolean), errorTag(string).";
  const r=await runWritingCheck(input,instructions);
  r.errorTag=normalizeErrorTag(r.errorTag,r);
  let evidence=0;
  if(r.skillSuccess){
   if(modelViewed) evidence=.25;
   else if(Number(hintLevel)>=2) evidence=.45;
   else if(Number(hintLevel)===1) evidence=.65;
   else if(firstTry) evidence=1;
   else evidence=.8;
  }
  const info=db.prepare("INSERT INTO attempts(exercise_id,prompt,grammar_focus,answer,correct,meaning,grammar,tense,capitalization,punctuation,feedback,suggestion,better_sentence,skill_id,exercise_type,session_date,error_tag) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(String(exerciseId),prompt,grammarFocus||"",answer,r.correct?1:0,r.meaning,r.grammar,r.tense,r.capitalization,r.punctuation,r.feedback,r.suggestion,r.betterSentence,skillId,exerciseType||"practice",today(),r.errorTag);
  const aid=Number(info.lastInsertRowid);
  db.prepare("INSERT INTO skill_attempts(attempt_id,skill_id,success,evidence_score,first_try,hint_level,model_viewed) VALUES(?,?,?,?,?,?,?)").run(aid,skillId,r.skillSuccess?1:0,evidence,firstTry?1:0,Number(hintLevel)||0,modelViewed?1:0);

  if(sessionItem){
   const newAttemptCount=previousAttempts+1;
   const firstTryCorrect=sessionItem.first_try_correct||(firstTry&&r.correct?1:0);
   db.prepare("UPDATE practice_session_items SET answer=?,correct=?,completed=?,attempt_count=?,hint_level=?,model_viewed=?,first_try_correct=?,last_feedback_json=?,updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND position=?")
    .run(answer,r.correct?1:0,r.correct?1:sessionItem.completed,newAttemptCount,Math.max(sessionItem.hint_level,Number(hintLevel)||0),sessionItem.model_viewed||(modelViewed?1:0),firstTryCorrect,JSON.stringify(r),Number(sessionId),Number(position));
   const stats=db.prepare("SELECT COUNT(*) total,SUM(completed) completed,SUM(correct) correct,SUM(first_try_correct) first_try_correct FROM practice_session_items WHERE session_id=?").get(Number(sessionId));
   const done=Number(stats.completed||0)>=Number(stats.total||0);
   db.prepare("UPDATE practice_sessions SET current_index=?,correct_count=?,first_try_correct=?,status=?,updated_at=CURRENT_TIMESTAMP,completed_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id=?")
    .run(Number(position),Number(stats.correct||0),Number(stats.first_try_correct||0),done?"completed":"in_progress",done?1:0,Number(sessionId));
  }

  const q=db.prepare("SELECT * FROM review_queue WHERE skill_id=?").get(skillId);
  if(r.skillSuccess&&evidence>=.65){
   if(q){const streak=q.streak+1;if(streak>=4) db.prepare("DELETE FROM review_queue WHERE skill_id=?").run(skillId);else db.prepare("UPDATE review_queue SET due_date=?,streak=?,updated_at=CURRENT_TIMESTAMP WHERE skill_id=?").run(addDays(nextReviewDays(streak)),streak,skillId);}
  }else if(!r.skillSuccess||evidence<.65){
   db.prepare("INSERT INTO review_queue(skill_id,due_date,streak,last_error) VALUES(?,?,0,?) ON CONFLICT(skill_id) DO UPDATE SET due_date=excluded.due_date,streak=0,last_error=excluded.last_error,updated_at=CURRENT_TIMESTAMP").run(skillId,addDays(1),(r.errorTag&&r.errorTag!=="none")?r.errorTag:"assisted_success");
  }
  res.json({...r,attemptId:aid,evidenceScore:evidence,firstTry});
 }catch(e){console.error(e);res.status(500).json({error:e?.message||"LLM request failed"});}
});

app.get("/api/health",async(req,res)=>{
 let ollamaAvailable=false;
 try{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),1500);const r=await fetch(ollamaBaseUrl+"/api/tags",{signal:controller.signal});clearTimeout(timer);ollamaAvailable=r.ok;}catch{}
 res.json({llm_provider:llmProvider,ollama_available:ollamaAvailable,ollama_base_url:ollamaBaseUrl,ollama_writing_model:ollamaModel,openai_enabled:Boolean(client),openai_model:openaiModel});
});

app.post("/api/complete-day",(req,res)=>{
 const date=today();
 db.prepare("INSERT OR IGNORE INTO daily_sessions(session_date) VALUES (?)").run(date);
 db.prepare("UPDATE daily_sessions SET completed=1,completed_at=CURRENT_TIMESTAMP WHERE session_date=?").run(date);
 res.json({ok:true,date});
});

app.use((err,req,res,next)=>{
 console.error(err);
 if(res.headersSent)return next(err);
 res.status(500).json({error:err?.message||"Server error"});
});

const host=process.env.HOST||"127.0.0.1";
app.listen(port,host,()=>console.log("Writing Trainer running on "+host+":"+port));
