import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SKILLS, skillMap, statusFromMastery, nextReviewDays } from "./src/curriculum.js";
import { CURRICULUM_VERSION, CURRICULUM_STAGES, CURRICULUM_LESSONS } from "./src/plan.js";
import { BASE_EXERCISES } from "./src/exercises.js";

const app = express();
const port = process.env.PORT || 5178;
const llmProvider = (process.env.LLM_PROVIDER || "ollama").toLowerCase();
const configuredOllamaBaseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:12000").replace(/\/$/, "");
const ollamaCandidateUrls = [...new Set([
 configuredOllamaBaseUrl,
 "http://127.0.0.1:12000",
 "http://127.0.0.1:11434"
].filter(Boolean).map(x=>String(x).replace(/\/$/,"")))];
let activeOllamaBaseUrl = null;
const ollamaModel = process.env.OLLAMA_WRITING_MODEL || "hf.co/unsloth/Qwen3.5-9B-GGUF:UD-Q4_K_XL";
const ollamaTimeoutMs = Number(process.env.OLLAMA_WRITING_TIMEOUT_SECONDS || 60) * 1000;
const ollamaGenerationTimeoutMs = Number(process.env.OLLAMA_GENERATION_TIMEOUT_SECONDS || 180) * 1000;
const ollamaGenerationBatchSize = Math.max(1,Math.min(6,Number(process.env.OLLAMA_GENERATION_BATCH_SIZE || 4)));
const openaiModel = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

function ollamaCandidateOrder(){
 return activeOllamaBaseUrl
  ? [activeOllamaBaseUrl,...ollamaCandidateUrls.filter(x=>x!==activeOllamaBaseUrl)]
  : ollamaCandidateUrls;
}

async function requestOllamaJson(pathname,{method="GET",body=null,timeoutMs=5000}={}){
 const errors=[];
 for(const base of ollamaCandidateOrder()){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetch(base+pathname,{
    method,
    headers:body==null?undefined:{"Content-Type":"application/json"},
    body:body==null?undefined:JSON.stringify(body),
    signal:controller.signal
   });
   if(!response.ok){
    let detail="";
    try{detail=(await response.text()).slice(0,240);}catch{}
    errors.push(base+": HTTP "+response.status+(detail?" "+detail:""));
    continue;
   }
   const data=await response.json();
   if(activeOllamaBaseUrl!==base){
    activeOllamaBaseUrl=base;
    console.log("[Ollama] Connected to "+base);
   }
   return {data,base};
  }catch(e){
   if(e?.name==="AbortError"){
    const message="Ollama request timed out after "+Math.round(timeoutMs/1000)+" seconds at "+base;
    if(activeOllamaBaseUrl===base) throw new Error(message);
    errors.push(message);
    continue;
   }
   const detail=e?.cause?.code||e?.cause?.message||e?.message||String(e);
   errors.push(base+": "+detail);
  }finally{
   clearTimeout(timer);
  }
 }
 throw new Error(
  "Could not connect to Ollama. Tried: "+ollamaCandidateUrls.join(", ")+
  ". Start Ollama in PowerShell with: $env:OLLAMA_HOST=\"127.0.0.1:12000\"; ollama serve"+
  (errors.length?". Details: "+errors.join(" | "):"")
 );
}

async function checkWithOllama(input, instructions) {
 const payload={
  model:ollamaModel, stream:false, think:false, keep_alive:"10m",
  format:schema,
  options:{temperature:0},
  messages:[
   {role:"system",content:instructions + " Return ONLY valid JSON matching the requested fields."},
   {role:"user",content:input}
  ]
 };
 const {data,base}=await requestOllamaJson("/api/chat",{method:"POST",body:payload,timeoutMs:ollamaTimeoutMs});
 return {...JSON.parse(data.message?.content || "{}"), provider:"ollama:"+ollamaModel+"@"+base};
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
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
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
for (const [name,type] of [["skill_id","TEXT"],["exercise_type","TEXT"],["session_date","TEXT"],["error_tag","TEXT"],["session_id","INTEGER"],["session_position","INTEGER"],["lesson_id","TEXT"]]) {
  if (!cols.includes(name)) db.exec(`ALTER TABLE attempts ADD COLUMN ${name} ${type}`);
}
db.exec(`
CREATE TABLE IF NOT EXISTS curriculum_stages (
 stage INTEGER PRIMARY KEY,
 title TEXT NOT NULL,
 goal TEXT NOT NULL,
 parent_note_zh TEXT,
 advancement TEXT NOT NULL,
 prompt_mode TEXT NOT NULL,
 sentence_mode TEXT NOT NULL,
 generation_guardrails_json TEXT NOT NULL,
 curriculum_version INTEGER NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS curriculum_lessons (
 id TEXT PRIMARY KEY,
 stage INTEGER NOT NULL,
 skill_id TEXT NOT NULL,
 order_in_stage INTEGER NOT NULL,
 title TEXT NOT NULL,
 objective TEXT NOT NULL,
 rules_json TEXT NOT NULL,
 common_errors_json TEXT NOT NULL,
 prompt_patterns_json TEXT NOT NULL,
 required_elements_json TEXT NOT NULL,
 avoid_json TEXT NOT NULL,
 difficulty TEXT NOT NULL,
 curriculum_version INTEGER NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_curriculum_lessons_stage ON curriculum_lessons(stage,order_in_stage);
CREATE INDEX IF NOT EXISTS idx_curriculum_lessons_skill ON curriculum_lessons(skill_id,stage,order_in_stage);
CREATE TABLE IF NOT EXISTS lesson_attempts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 attempt_id INTEGER NOT NULL,
 lesson_id TEXT NOT NULL,
 skill_id TEXT NOT NULL,
 success INTEGER NOT NULL,
 evidence_score REAL,
 first_try INTEGER,
 hint_level INTEGER,
 model_viewed INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lesson_attempts_lesson ON lesson_attempts(lesson_id,created_at);
`);

function seedCurriculumPlan(){
 const stageUpsert=db.prepare(`INSERT INTO curriculum_stages(stage,title,goal,parent_note_zh,advancement,prompt_mode,sentence_mode,generation_guardrails_json,curriculum_version)
  VALUES(?,?,?,?,?,?,?,?,?)
  ON CONFLICT(stage) DO UPDATE SET
   title=excluded.title,goal=excluded.goal,parent_note_zh=excluded.parent_note_zh,advancement=excluded.advancement,
   prompt_mode=excluded.prompt_mode,sentence_mode=excluded.sentence_mode,generation_guardrails_json=excluded.generation_guardrails_json,
   curriculum_version=excluded.curriculum_version,updated_at=CURRENT_TIMESTAMP`);
 const lessonUpsert=db.prepare(`INSERT INTO curriculum_lessons(id,stage,skill_id,order_in_stage,title,objective,rules_json,common_errors_json,prompt_patterns_json,required_elements_json,avoid_json,difficulty,curriculum_version,enabled)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)
  ON CONFLICT(id) DO UPDATE SET
   stage=excluded.stage,skill_id=excluded.skill_id,order_in_stage=excluded.order_in_stage,title=excluded.title,objective=excluded.objective,
   rules_json=excluded.rules_json,common_errors_json=excluded.common_errors_json,prompt_patterns_json=excluded.prompt_patterns_json,
   required_elements_json=excluded.required_elements_json,avoid_json=excluded.avoid_json,difficulty=excluded.difficulty,
   curriculum_version=excluded.curriculum_version,enabled=1,updated_at=CURRENT_TIMESTAMP`);
 const run=db.transaction(()=>{
  db.prepare("UPDATE curriculum_lessons SET enabled=0").run();
  for(const s of CURRICULUM_STAGES){
   stageUpsert.run(s.stage,s.title,s.goal,s.parentNoteZh||"",s.advancement,s.promptMode,s.sentenceMode,JSON.stringify(s.generationGuardrails||[]),CURRICULUM_VERSION);
  }
  for(const l of CURRICULUM_LESSONS){
   lessonUpsert.run(l.id,l.stage,l.skillId,l.order,l.title,l.objective,JSON.stringify(l.rules||[]),JSON.stringify(l.commonErrors||[]),JSON.stringify(l.promptPatterns||[]),JSON.stringify(l.requiredElements||[]),JSON.stringify(l.avoid||[]),l.difficulty,CURRICULUM_VERSION);
  }
 });
 run();
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
 independent_correct INTEGER NOT NULL DEFAULT 0,
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
 independent_correct INTEGER NOT NULL DEFAULT 0,
 last_feedback_json TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE,
 UNIQUE(session_id, position)
);
CREATE INDEX IF NOT EXISTS idx_practice_sessions_group ON practice_sessions(group_id, status, id DESC);
CREATE INDEX IF NOT EXISTS idx_session_items_session ON practice_session_items(session_id, position);
`);
const practiceSessionCols=db.prepare("PRAGMA table_info(practice_sessions)").all().map(x=>x.name);
if(!practiceSessionCols.includes("independent_correct")) db.exec("ALTER TABLE practice_sessions ADD COLUMN independent_correct INTEGER NOT NULL DEFAULT 0");
const practiceSessionItemCols=db.prepare("PRAGMA table_info(practice_session_items)").all().map(x=>x.name);
if(!practiceSessionItemCols.includes("independent_correct")) db.exec("ALTER TABLE practice_session_items ADD COLUMN independent_correct INTEGER NOT NULL DEFAULT 0");

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
seedCurriculumPlan();
setState.run("curriculumVersion",String(CURRICULUM_VERSION));
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
 "vocabulary","meaning","incomplete_sentence","assisted_success","other"
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
  meaning:"meaning",semantic:"meaning",incomplete_sentence:"incomplete_sentence",fragment:"incomplete_sentence",none:"none"
 };
 return map[raw] ? map[raw] : (ERROR_TAGS.includes(raw) ? raw : "other");
}

function parseJsonArray(value){
 try{return Array.isArray(value)?value:JSON.parse(value||"[]");}catch{return [];}
}

function lessonMasteryRows(){
 const rows=db.prepare("SELECT id,stage,skill_id,order_in_stage,title,objective,rules_json,common_errors_json,prompt_patterns_json,required_elements_json,avoid_json,difficulty FROM curriculum_lessons WHERE enabled=1 ORDER BY stage,order_in_stage,id").all();
 return rows.map(l=>{
  const ev=db.prepare("SELECT success,evidence_score,first_try,hint_level,model_viewed FROM lesson_attempts WHERE lesson_id=? ORDER BY id DESC LIMIT 10").all(l.id);
  const attempts=ev.length;
  let score=0,independentCorrect=0,assistedCorrect=0;
  if(attempts){
   const weights=ev.map((_,i)=>Math.max(1,10-i));
   const values=ev.map(r=>r.evidence_score==null?(r.success?1:0):Number(r.evidence_score));
   score=Math.round(values.reduce((a,v,i)=>a+v*weights[i],0)/weights.reduce((a,b)=>a+b,0)*100);
   independentCorrect=ev.filter(r=>r.success&&r.first_try===1&&(r.hint_level||0)===0&&(r.model_viewed||0)===0).length;
   assistedCorrect=ev.filter(r=>r.success&&!((r.first_try===1)&&(r.hint_level||0)===0&&(r.model_viewed||0)===0)).length;
  }
  return {...l,
   rules:parseJsonArray(l.rules_json),commonErrors:parseJsonArray(l.common_errors_json),promptPatterns:parseJsonArray(l.prompt_patterns_json),
   requiredElements:parseJsonArray(l.required_elements_json),avoid:parseJsonArray(l.avoid_json),
   attempts,score,status:statusFromMastery(score,attempts),independentCorrect,assistedCorrect
  };
 });
}

function curriculumLesson(id){
 const l=db.prepare("SELECT * FROM curriculum_lessons WHERE id=? AND enabled=1").get(id);
 if(!l) return null;
 return {...l,rules:parseJsonArray(l.rules_json),commonErrors:parseJsonArray(l.common_errors_json),promptPatterns:parseJsonArray(l.prompt_patterns_json),requiredElements:parseJsonArray(l.required_elements_json),avoid:parseJsonArray(l.avoid_json)};
}

function curriculumStage(stage){
 const s=db.prepare("SELECT * FROM curriculum_stages WHERE stage=?").get(stage);
 if(!s) return null;
 return {...s,generationGuardrails:parseJsonArray(s.generation_guardrails_json)};
}

function promptLanguageProblem(prompt,lesson){
 const text=String(prompt||"");
 if(Number(lesson?.stage)<=9 && !containsChinese(text)) return "prompt must be Simplified Chinese for Stage "+lesson.stage;
 if(Number(lesson?.stage)>=11 && containsChinese(text)) return "prompt must be English-first with no Chinese for Stage "+lesson.stage;
 return "";
}

function resolveExerciseLesson(exercise,maxStage=12){
 if(exercise?.lessonId){
  const exact=curriculumLesson(exercise.lessonId);
  if(exact) return exact;
 }
 const skillId=String(exercise?.skill||"");
 if(!skillId) return null;
 let lesson=db.prepare("SELECT * FROM curriculum_lessons WHERE skill_id=? AND enabled=1 AND stage<=? ORDER BY stage,order_in_stage,id LIMIT 1").get(skillId,maxStage);
 if(!lesson) lesson=db.prepare("SELECT * FROM curriculum_lessons WHERE skill_id=? AND enabled=1 ORDER BY stage,order_in_stage,id LIMIT 1").get(skillId);
 return lesson?{...lesson,rules:parseJsonArray(lesson.rules_json),commonErrors:parseJsonArray(lesson.common_errors_json),promptPatterns:parseJsonArray(lesson.prompt_patterns_json),requiredElements:parseJsonArray(lesson.required_elements_json),avoid:parseJsonArray(lesson.avoid_json)}:null;
}

function decorateExercisePlan(exercise,maxStage=12){
 const lesson=resolveExerciseLesson(exercise,maxStage);
 const stage=lesson?curriculumStage(lesson.stage):null;
 const skillId=String(exercise?.skill||lesson?.skill_id||"");
 return {
  ...exercise,
  lessonId:exercise?.lessonId||lesson?.id||"",
  planMeta:{
   stage:lesson?.stage||skillMap[skillId]?.stage||null,
   stageTitle:stage?.title||"",
   lessonId:exercise?.lessonId||lesson?.id||"",
   lessonTitle:lesson?.title||"",
   skillId,
   skillName:skillMap[skillId]?.name||skillId,
   objective:lesson?.objective||"",
   difficulty:lesson?.difficulty||""
  }
 };
}

function decorateExerciseList(exercises,maxStage=12){
 return exercises.map(q=>decorateExercisePlan(q,maxStage));
}

function chooseLessonSequence(skillSequence,maxStage,forcedLessonId=null){
 const mastery=new Map(lessonMasteryRows().map(x=>[x.id,x]));
 if(forcedLessonId){
  const forced=curriculumLesson(forcedLessonId);
  if(!forced) throw new Error("Unknown lesson: "+forcedLessonId);
  if(skillSequence.some(x=>x!==forced.skill_id)) throw new Error("Forced lesson does not match selected skill");
  return skillSequence.map(()=>forced);
 }
 const counters={};
 return skillSequence.map(skillId=>{
  let candidates=db.prepare("SELECT * FROM curriculum_lessons WHERE skill_id=? AND enabled=1 AND stage<=? ORDER BY stage,order_in_stage,id").all(skillId,maxStage);
  if(!candidates.length) candidates=db.prepare("SELECT * FROM curriculum_lessons WHERE skill_id=? AND enabled=1 ORDER BY stage,order_in_stage,id").all(skillId);
  if(!candidates.length) return null;
  candidates=candidates.map(x=>({...x,mastery:mastery.get(x.id)||{attempts:0,score:0}}))
   .sort((a,b)=>(a.mastery.attempts-b.mastery.attempts)||(a.mastery.score-b.mastery.score)||(a.stage-b.stage)||(a.order_in_stage-b.order_in_stage));
  const n=counters[skillId]||0;counters[skillId]=n+1;
  return candidates[n%candidates.length];
 });
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

function skillReadyForNextStage(skill){
 return skill.attempts>=2 && skill.score>=75;
}

function lessonReadyForNextStage(lesson){
 return lesson.attempts>=2 && lesson.score>=75;
}

function currentStage(){
 const lessons=lessonMasteryRows();
 for(let stage=1;stage<=12;stage++){
  const relevant=lessons.filter(x=>x.stage===stage);
  if(relevant.length&&relevant.some(x=>!lessonReadyForNextStage(x))) return stage;
 }
 return 12;
}

function stageSkillIds(stage){
 return db.prepare("SELECT DISTINCT skill_id FROM curriculum_lessons WHERE stage=? AND enabled=1 ORDER BY order_in_stage,skill_id").all(stage).map(x=>x.skill_id);
}


function exerciseSchemaFor(allowed,count,mode,allowedLessonIds=[]){
 return {
  type:"object",additionalProperties:false,
  properties:{exercises:{
   type:"array",minItems:count,maxItems:count,
   items:{type:"object",additionalProperties:false,properties:{
    id:{type:"string"},
    lessonId:allowedLessonIds.length?{type:"string",enum:allowedLessonIds}:{type:"string"},
    type:{type:"string",enum:[mode]},
    skill:{type:"string",enum:allowed},
    reviewSkills:{type:"array",items:{type:"string"}},
    prompt:{type:"string"},
    focus:{type:"string"},
    hints:{type:"array",minItems:3,maxItems:3,items:{type:"string"}},
    model:{type:"string"}
   },required:["id","lessonId","type","skill","reviewSkills","prompt","focus","hints","model"]}
  }},
  required:["exercises"]
 };
}

function containsChinese(text){
 return /[\u3400-\u4dbf\u4e00-\u9fff]/u.test(String(text||""));
}

function normalizePromptKey(text){
 return String(text||"")
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[\p{P}\p{S}\s]+/gu,"")
  .trim();
}

function allHistoricalPromptKeys(){
 const keys=new Set();
 for(const r of db.prepare("SELECT prompt FROM practice_group_items WHERE prompt IS NOT NULL AND prompt!=''").all()) keys.add(normalizePromptKey(r.prompt));
 for(const r of db.prepare("SELECT prompt FROM attempts WHERE prompt IS NOT NULL AND prompt!=''").all()) keys.add(normalizePromptKey(r.prompt));
 keys.delete("");
 return keys;
}

function recentHistoricalPrompts(skillIds,limit=40){
 const ids=[...new Set((skillIds||[]).filter(Boolean))];
 const rows=[];
 if(ids.length){
  const placeholders=ids.map(()=>"?").join(",");
  rows.push(...db.prepare("SELECT prompt FROM practice_group_items WHERE skill_id IN ("+placeholders+") AND prompt IS NOT NULL AND prompt!='' ORDER BY id DESC LIMIT ?").all(...ids,limit));
  rows.push(...db.prepare("SELECT prompt FROM attempts WHERE skill_id IN ("+placeholders+") AND prompt IS NOT NULL AND prompt!='' ORDER BY id DESC LIMIT ?").all(...ids,limit));
 }else{
  rows.push(...db.prepare("SELECT prompt FROM practice_group_items WHERE prompt IS NOT NULL AND prompt!='' ORDER BY id DESC LIMIT ?").all(limit));
 }
 const seen=new Set(),out=[];
 for(const r of rows){
  const key=normalizePromptKey(r.prompt);
  if(!key||seen.has(key)) continue;
  seen.add(key);out.push(String(r.prompt));
  if(out.length>=limit) break;
 }
 return out;
}

function hasPriorPracticeHistory(date=today()){
 return Boolean(
  db.prepare("SELECT 1 FROM attempts WHERE COALESCE(session_date,date(created_at,'localtime'))<? LIMIT 1").get(date)||
  db.prepare("SELECT 1 FROM practice_sessions WHERE status='completed' AND date(started_at,'localtime')<? LIMIT 1").get(date)
 );
}

function validateGeneratedExercises(exercises,allowed,count,mode){
 if(!Array.isArray(exercises)) return "exercises is not an array";
 if(exercises.length!==count) return "expected "+count+" exercises, got "+exercises.length;
 const seen=new Set();
 for(let i=0;i<exercises.length;i++){
  const q=exercises[i]||{};
  if(!allowed.includes(q.skill)) return "exercise "+(i+1)+" used disallowed skill: "+q.skill;
  if(q.type!==mode) return "exercise "+(i+1)+" has wrong type: "+q.type;
  if(!String(q.prompt||"").trim()) return "exercise "+(i+1)+" has an empty prompt";
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
 const current=stageSkillIds(stage);
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
 const current=stageSkillIds(stage);
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

async function generateExercises(skills,count,mode,targetSequence=null,{maxStage=12,forcedLessonId=null}={}){
 const allowed=[...new Set(skills.filter(x=>skillMap[x]))];
 if(!allowed.length) throw new Error("No valid curriculum skills were selected");
 const sequence=Array.isArray(targetSequence)&&targetSequence.length===count?targetSequence:buildSkillSequence(allowed,count);
 const lessonSequence=chooseLessonSequence(sequence,maxStage,forcedLessonId);
 if(lessonSequence.some(x=>!x)) throw new Error("No curriculum lesson guidance exists for one or more selected skills");
 const historicalPromptKeys=allHistoricalPromptKeys();
 const instructions=[
  "Create English writing exercises for an 11-year-old sixth-grade ESL student.",
  "Prompt language MUST follow the assigned curriculum stage. Stages 1-9 use Simplified Chinese; Stage 10 may use a short Chinese or English situation; Stages 11-12 use English-first school-style prompts.",
  "The model field MUST be the natural American English answer.",
  "Never put the English model answer in prompt.",
  "Use ONLY the allowed primary skill IDs.",
  "Test one primary skill per item.",
  "Give exactly 3 progressive hints. Hint 1 names the grammar idea without revealing the answer. Hint 2 gives a structure or verb-form clue. Hint 3 gives key words or word order but still does not reveal the full model sentence.",
  "Do not duplicate prompts.",
  "Follow the exact lesson guidance for each numbered item. Do not improvise a different grammar target.",
  "The lessonId field must exactly match the assigned lesson id for that item.",
  "Treat prompt patterns as style examples, not text to copy repeatedly.",
  "Keep vocabulary easier than the grammar target so the exercise measures writing grammar rather than obscure vocabulary.",
  "The focus field should name the assigned lesson target in short student-friendly wording.",
  "Return only valid JSON matching the schema."
 ].join(" ");

 async function callOllamaBatch(batchSequence,priorPrompts,retryNote="",batchStart=0){
  const batchAllowed=[...new Set(batchSequence)];
  const batchCount=batchSequence.length;
  const batchLessons=lessonSequence.slice(batchStart,batchStart+batchCount);
  const format=exerciseSchemaFor(batchAllowed,batchCount,mode,batchLessons.map(x=>x.id));
  const guidance=batchLessons.map((l,i)=>{const s=curriculumStage(l.stage);return [
   "ITEM "+(i+1),
   "lessonId="+l.id,
   "skill="+l.skill_id,
   "lesson="+l.title,
   "objective="+l.objective,
   "difficulty="+l.difficulty,
   "rules="+parseJsonArray(l.rules_json).join(" | "),
   "common errors to target="+parseJsonArray(l.common_errors_json).join(" | "),
   "prompt-pattern examples="+parseJsonArray(l.prompt_patterns_json).join(" | "),
   "required elements="+parseJsonArray(l.required_elements_json).join(" | "),
   "avoid="+parseJsonArray(l.avoid_json).join(" | "),
   "stage goal="+(s?.goal||""),
   "prompt mode="+(s?.prompt_mode||""),
   "expected output="+(s?.sentence_mode||""),
   "stage guardrails="+(s?.generationGuardrails||[]).join(" | ")
  ].join("; ")}).join("\n");
  const historyPrompts=recentHistoricalPrompts(batchAllowed,40);
  const forbidden=[...new Set([...historyPrompts,...priorPrompts])];
  const input="Mode: "+mode+". Generate exactly "+batchCount+" exercises. Allowed primary skill IDs: "+batchAllowed.join(", ")+
   ". Skill descriptions: "+batchAllowed.map(id=>id+": "+skillMap[id].description).join("; ")+
   ". Exact item-by-item curriculum guidance follows. You MUST obey it:\n"+guidance+
   (forbidden.length?"\nFORBIDDEN PREVIOUS PROMPTS — do not reuse these sentences, and do not make cosmetic-only rewrites of them: "+forbidden.join(" | "):"")+
   "\nUse a genuinely new subject, situation, object, time, place, or detail while testing the same grammar target."+
   retryNote;
  try{
   const {data}=await requestOllamaJson("/api/chat",{
    method:"POST",
    timeoutMs:ollamaGenerationTimeoutMs,
    body:{
     model:ollamaModel,stream:false,think:false,keep_alive:"10m",format,
     options:{temperature:0},
     messages:[{role:"system",content:instructions},{role:"user",content:input}]
    }
   });
   return JSON.parse(data.message?.content||"{}").exercises;
  }catch(e){
   if(String(e?.message||"").includes("timed out")){
    throw new Error("Ollama generation timed out after "+Math.round(ollamaGenerationTimeoutMs/1000)+" seconds for a "+batchCount+"-question batch. "+e.message);
   }
   throw e;
  }
 }

 async function callOpenAIBatch(batchSequence,priorPrompts,retryNote="",batchStart=0){
  if(!client) throw new Error("OpenAI fallback unavailable");
  const batchAllowed=[...new Set(batchSequence)];
  const batchCount=batchSequence.length;
  const batchLessons=lessonSequence.slice(batchStart,batchStart+batchCount);
  const format=exerciseSchemaFor(batchAllowed,batchCount,mode,batchLessons.map(x=>x.id));
  const guidance=batchLessons.map((l,i)=>{const s=curriculumStage(l.stage);return [
   "ITEM "+(i+1),"lessonId="+l.id,"skill="+l.skill_id,"lesson="+l.title,"objective="+l.objective,"difficulty="+l.difficulty,
   "rules="+parseJsonArray(l.rules_json).join(" | "),"common errors to target="+parseJsonArray(l.common_errors_json).join(" | "),
   "prompt-pattern examples="+parseJsonArray(l.prompt_patterns_json).join(" | "),"required elements="+parseJsonArray(l.required_elements_json).join(" | "),
   "avoid="+parseJsonArray(l.avoid_json).join(" | "),
   "stage goal="+(s?.goal||""),
   "prompt mode="+(s?.prompt_mode||""),
   "expected output="+(s?.sentence_mode||""),
   "stage guardrails="+(s?.generationGuardrails||[]).join(" | ")
  ].join("; ")}).join("\n");
  const historyPrompts=recentHistoricalPrompts(batchAllowed,40);
  const forbidden=[...new Set([...historyPrompts,...priorPrompts])];
  const input="Mode: "+mode+". Generate exactly "+batchCount+" exercises. Allowed primary skill IDs: "+batchAllowed.join(", ")+
   ". Skill descriptions: "+batchAllowed.map(id=>id+": "+skillMap[id].description).join("; ")+
   ". Exact item-by-item curriculum guidance follows. You MUST obey it:\n"+guidance+
   (forbidden.length?"\nFORBIDDEN PREVIOUS PROMPTS — do not reuse these sentences, and do not make cosmetic-only rewrites of them: "+forbidden.join(" | "):"")+
   "\nUse a genuinely new subject, situation, object, time, place, or detail while testing the same grammar target."+
   retryNote;
  const r=await client.responses.create({
   model:openaiModel,reasoning:{effort:"none"},
   max_output_tokens:Math.min(3000,Math.max(900,batchCount*260)),
   instructions,input,
   text:{format:{type:"json_schema",name:"exercise_set",strict:true,schema:format}}
  });
  return JSON.parse(r.output_text).exercises;
 }

 async function generateBatch(batchSequence,priorPrompts,batchStart){
  const batchAllowed=[...new Set(batchSequence)];
  const batchCount=batchSequence.length;
  let lastError="";
  for(let attempt=1;attempt<=2;attempt++){
   const retryNote=lastError?" Previous output was rejected because: "+lastError+". Correct that exact problem.":"";
   try{
    let batch;
    if(llmProvider==="openai"){
     batch=await callOpenAIBatch(batchSequence,priorPrompts,retryNote,batchStart);
    }else{
     try{
      batch=await callOllamaBatch(batchSequence,priorPrompts,retryNote,batchStart);
     }catch(e){
      if(llmProvider!=="auto") throw e;
      console.warn("Ollama generation batch failed; using OpenAI fallback:",e.message);
      batch=await callOpenAIBatch(batchSequence,priorPrompts,retryNote,batchStart);
     }
    }
    let problem=validateGeneratedExercises(batch,batchAllowed,batchCount,mode);
    if(!problem){
     for(let i=0;i<batchCount;i++){
      const assignedLesson=lessonSequence[batchStart+i];
      if(batch[i]?.skill!==batchSequence[i]){
       problem="exercise "+(i+1)+" must use skill "+batchSequence[i]+", got "+batch[i]?.skill;
       break;
      }
      if(batch[i]?.lessonId!==assignedLesson?.id){
       problem="exercise "+(i+1)+" must use lessonId "+assignedLesson?.id+", got "+batch[i]?.lessonId;
       break;
      }
      const languageProblem=promptLanguageProblem(batch[i]?.prompt,assignedLesson);
      if(languageProblem){problem="exercise "+(i+1)+" "+languageProblem;break;}
      const generatedPrompt=String(batch[i]?.prompt||"").trim();
      const generatedKey=normalizePromptKey(generatedPrompt);
      if(priorPrompts.some(p=>normalizePromptKey(p)===generatedKey)){
       problem="prompt duplicates an earlier batch: "+generatedPrompt;
       break;
      }
      if(historicalPromptKeys.has(generatedKey)){
       problem="prompt was already used in an earlier saved practice set: "+generatedPrompt;
       break;
      }
     }
    }
    if(!problem) return batch;
    lastError=problem;
    console.warn("Rejected generated batch:",problem);
   }catch(e){
    lastError=e?.message||String(e);
    if(lastError.startsWith("Ollama generation timed out")||attempt===2) throw new Error(lastError);
   }
  }
  throw new Error(lastError||"Exercise generation failed");
 }

 const all=[];
 for(let offset=0;offset<count;offset+=ollamaGenerationBatchSize){
  const batchSequence=sequence.slice(offset,offset+ollamaGenerationBatchSize);
  const priorPrompts=all.map(x=>String(x.prompt||"").trim());
  console.log("Generating exercise batch "+(Math.floor(offset/ollamaGenerationBatchSize)+1)+"/"+Math.ceil(count/ollamaGenerationBatchSize)+" ("+batchSequence.length+" questions)");
  const batch=await generateBatch(batchSequence,priorPrompts,offset);
  all.push(...batch);
 }

 all.forEach((q,i)=>{q.id="generated-"+Date.now()+"-"+(i+1);});
 let problem=validateGeneratedExercises(all,allowed,count,mode);
 if(!problem){
  for(let i=0;i<count;i++){
   if(all[i]?.skill!==sequence[i]){
    problem="exercise "+(i+1)+" must use skill "+sequence[i]+", got "+all[i]?.skill;
    break;
   }
   if(all[i]?.lessonId!==lessonSequence[i]?.id){
    problem="exercise "+(i+1)+" must use lessonId "+lessonSequence[i]?.id+", got "+all[i]?.lessonId;
    break;
   }
   if(historicalPromptKeys.has(normalizePromptKey(all[i]?.prompt))){
    problem="exercise "+(i+1)+" repeats a prompt from saved practice history: "+all[i]?.prompt;
    break;
   }
  }
 }
 if(problem) throw new Error("Generated set failed final validation: "+problem);
 return all;
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

function ensureBasePracticeGroup(count){
 const actual=Math.max(1,Math.min(Number(count)||BASE_EXERCISES.length,BASE_EXERCISES.length));
 if(actual===BASE_EXERCISES.length){
  const legacy=db.prepare("SELECT id FROM practice_groups WHERE archive_key='base:starter'").get();
  if(legacy) return legacy.id;
 }
 const archiveKey="base:starter:"+actual;
 const existing=db.prepare("SELECT id FROM practice_groups WHERE archive_key=?").get(archiveKey);
 if(existing) return existing.id;
 return archivePracticeGroup("today",null,BASE_EXERCISES.slice(0,actual),{
  archiveKey,
  title:"Starter Practice · "+actual+" questions"
 });
}

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

app.get("/api/plan",(req,res)=>{
 const skills=masteryRows();
 const lessons=lessonMasteryRows();
 const stages=db.prepare("SELECT * FROM curriculum_stages ORDER BY stage").all().map(s=>({
  stage:s.stage,title:s.title,goal:s.goal,parentNoteZh:s.parent_note_zh,advancement:s.advancement,promptMode:s.prompt_mode,sentenceMode:s.sentence_mode,
  generationGuardrails:parseJsonArray(s.generation_guardrails_json),
  lessons:lessons.filter(l=>l.stage===s.stage)
 }));
 res.json({curriculumVersion:CURRICULUM_VERSION,currentStage:currentStage(),skills,stages});
});

app.post("/api/generate",async(req,res)=>{
 try{
  const mode=String(req.body?.mode||"today"), requestedSkill=String(req.body?.skillId||""), requestedLesson=String(req.body?.lessonId||""), force=Boolean(req.body?.force);
  const mastery=masteryRows(),stage=currentStage(),date=today(); let skills=[],count=getPracticeCount(),setKey="",sequence=[];
  if(mode==="skill"){
   if(!skillMap[requestedSkill]) return res.status(400).json({error:"Unknown skill"});
   skills=[requestedSkill];sequence=buildSkillSequence(skills,count);setKey="skill:"+requestedSkill+":"+(requestedLesson||"all")+":"+date;
   if(requestedLesson){const lesson=curriculumLesson(requestedLesson);if(!lesson||lesson.skill_id!==requestedSkill)return res.status(400).json({error:"Lesson does not match skill"});}
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
    const cacheAllowed=mode==="skill"?[requestedSkill]:SKILLS.map(x=>x.id);
    const problem=validateGeneratedExercises(parsed,cacheAllowed,count,mode);
    if(!problem) return res.json({cached:true,mode,groupId:cached.group_id||null,exercises:decorateExerciseList(parsed,stage)});
    db.prepare("DELETE FROM generated_sets WHERE set_key=?").run(setKey);
    console.warn("Discarded invalid cached set:",setKey,problem);
   }
  }
  const exercises=await generateExercises(skills,count,mode,sequence,{maxStage:stage,forcedLessonId:requestedLesson||null});
  const forcedLesson=requestedLesson?curriculumLesson(requestedLesson):null;
  const groupId=archivePracticeGroup(mode,requestedSkill||null,exercises,{title:forcedLesson?(forcedLesson.title+" Practice · "+date+" · "+exercises.length+" questions"):null});
  db.prepare("INSERT INTO generated_sets(set_key,mode,skill_id,exercises_json,group_id) VALUES(?,?,?,?,?) ON CONFLICT(set_key) DO UPDATE SET exercises_json=excluded.exercises_json,skill_id=excluded.skill_id,group_id=excluded.group_id,created_at=CURRENT_TIMESTAMP").run(setKey,mode,requestedSkill||null,JSON.stringify(exercises),groupId);
  res.json({cached:false,mode,groupId,exercises:decorateExerciseList(exercises,stage)});
 }catch(e){console.error(e);res.status(500).json({error:e?.message||"Generation failed"});}
});

app.get("/api/today",(req,res)=>{
 const date=today();
 db.prepare("INSERT OR IGNORE INTO daily_sessions(session_date) VALUES (?)").run(date);
 const mastery=masteryRows();
 const stage=currentStage();
 const practiceCount=getPracticeCount();
 const due=db.prepare("SELECT * FROM review_queue WHERE due_date<=? ORDER BY due_date LIMIT 4").all(date);
 const sequence=buildTodaySkillSequence(mastery,stage,date,practiceCount);
 let generated=false,groupId=null,needsGeneration=false;
 let exercises=[];
 const cached=db.prepare("SELECT exercises_json,group_id FROM generated_sets WHERE set_key=?").get("today:"+date);
 if(cached){
  const parsed=JSON.parse(cached.exercises_json);
  const problem=validateGeneratedExercises(parsed,SKILLS.map(x=>x.id),practiceCount,"today");
  if(!problem){exercises=parsed;generated=true;groupId=cached.group_id||null;}
  else{db.prepare("DELETE FROM generated_sets WHERE set_key=?").run("today:"+date);console.warn("Discarded invalid today cache:",problem);}
 }
 if(!generated){
  if(hasPriorPracticeHistory(date)){
   needsGeneration=true;
  }else{
   exercises=BASE_EXERCISES.slice(0,Math.min(practiceCount,BASE_EXERCISES.length));
   groupId=ensureBasePracticeGroup(exercises.length);
  }
 }
 res.json({date,stage,practiceCount,groupId,exercises:decorateExerciseList(exercises,stage),dueReviews:due,mastery,generated,needsGeneration});
});

function periodMetrics(days){
 const cutoff="-"+days+" days";
 const q=db.prepare(`SELECT COUNT(*) questions,
  SUM(CASE WHEN correct=1 THEN 1 ELSE 0 END) correct,
  SUM(CASE WHEN first_try_correct=1 THEN 1 ELSE 0 END) first_try,
  SUM(CASE WHEN independent_correct=1 THEN 1 ELSE 0 END) independent,
  SUM(CASE WHEN hint_level>0 THEN 1 ELSE 0 END) hints,
  SUM(CASE WHEN model_viewed=1 THEN 1 ELSE 0 END) model_viewed
  FROM practice_session_items
  WHERE attempt_count>0 AND updated_at>=datetime('now',?)`).get(cutoff);
 const sessions=db.prepare(`SELECT COUNT(*) total,
  SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed
  FROM practice_sessions WHERE started_at>=datetime('now',?)`).get(cutoff);
 const checks=db.prepare(`SELECT COUNT(*) checks,
  SUM(CASE WHEN correct=1 THEN 1 ELSE 0 END) correct_checks,
  SUM(CASE WHEN error_tag IS NOT NULL AND error_tag NOT IN ('none','assisted_success') THEN 1 ELSE 0 END) errors
  FROM attempts WHERE session_date>=date('now',?)`).get(cutoff);
 const questions=Number(q.questions||0);
 return {
  days,
  questions,
  finalCorrect:Number(q.correct||0),
  firstTryCorrect:Number(q.first_try||0),
  firstTryRate:questions?Math.round(Number(q.first_try||0)/questions*100):0,
  independentCorrect:Number(q.independent||0),
  independentRate:questions?Math.round(Number(q.independent||0)/questions*100):0,
  hintUsed:Number(q.hints||0),
  modelViewed:Number(q.model_viewed||0),
  sessions:Number(sessions.total||0),
  completedSessions:Number(sessions.completed||0),
  checks:Number(checks.checks||0),
  correctChecks:Number(checks.correct_checks||0),
  errors:Number(checks.errors||0)
 };
}

app.get("/api/progress",(req,res)=>{
 const mastery=masteryRows();
 const lessonMastery=lessonMasteryRows();
 const stage=currentStage();
 const stageLessons=lessonMastery.filter(x=>x.stage===stage);
 const stableLessons=stageLessons.filter(lessonReadyForNextStage);
 const blockers=stageLessons.filter(x=>!lessonReadyForNextStage(x)).sort((a,b)=>(a.attempts-b.attempts)||(a.score-b.score));
 const totals=db.prepare("SELECT COUNT(*) attempts, SUM(correct) correct FROM attempts").get();
 const sessions=db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed FROM practice_sessions").get();
 const errors=db.prepare(`SELECT error_tag error,COUNT(*) count
  FROM attempts
  WHERE error_tag IS NOT NULL AND error_tag NOT IN ('none','assisted_success')
   AND session_date>=date('now','-30 days')
  GROUP BY error_tag ORDER BY count DESC,error_tag LIMIT 10`).all();
 const trend=db.prepare(`SELECT a.session_date date,COUNT(*) checks,SUM(a.correct) correct,
  SUM(CASE WHEN a.error_tag IS NOT NULL AND a.error_tag NOT IN ('none','assisted_success') THEN 1 ELSE 0 END) errors,
  SUM(CASE WHEN sa.success=1 AND sa.first_try=1 AND COALESCE(sa.hint_level,0)=0 AND COALESCE(sa.model_viewed,0)=0 THEN 1 ELSE 0 END) independent_correct
  FROM attempts a LEFT JOIN skill_attempts sa ON sa.attempt_id=a.id
  WHERE a.session_date>=date('now','-13 days')
  GROUP BY a.session_date ORDER BY a.session_date`).all();
 const recentSessions=db.prepare(`SELECT id,group_id,title,mode,status,total_items,correct_count,first_try_correct,independent_correct,started_at,completed_at
  FROM practice_sessions ORDER BY id DESC LIMIT 10`).all();
 res.json({
  mastery,stage,totals,sessions,errors,trend,recentSessions,
  last7:periodMetrics(7),last30:periodMetrics(30),
  stageProgress:{
   stage,total:stageLessons.length,stable:stableLessons.length,
   percent:stageLessons.length?Math.round(stableLessons.length/stageLessons.length*100):100,
   blockers:blockers.map(x=>({id:x.id,name:x.title,skillId:x.skill_id,score:x.score,status:x.status,attempts:x.attempts,neededAttempts:Math.max(0,2-x.attempts)}))
  }
 });
});

app.get("/api/lessons/:id",(req,res)=>{
 const id=String(req.params.id||"");
 const lesson=lessonMasteryRows().find(x=>x.id===id);
 if(!lesson) return res.status(404).json({error:"Unknown curriculum lesson"});
 const attempts=db.prepare(`SELECT a.id,a.session_date,a.prompt,a.answer,a.correct,a.error_tag,a.feedback,a.suggestion,a.better_sentence,a.created_at,a.lesson_id,
  la.success,la.evidence_score,la.first_try,la.hint_level,la.model_viewed,ps.title session_title,ps.mode session_mode
  FROM attempts a
  LEFT JOIN lesson_attempts la ON la.attempt_id=a.id AND la.lesson_id=?
  LEFT JOIN practice_sessions ps ON ps.id=a.session_id
  WHERE a.lesson_id=? ORDER BY a.id DESC LIMIT 30`).all(id,id);
 res.json({lesson,attempts});
});

app.get("/api/skills/:id",(req,res)=>{
 const id=String(req.params.id||"");
 if(!skillMap[id]) return res.status(404).json({error:"Unknown skill"});
 const mastery=masteryRows().find(x=>x.id===id);
 const attempts=db.prepare(`SELECT a.id,a.session_date,a.prompt,a.answer,a.correct,a.error_tag,a.feedback,a.suggestion,a.better_sentence,a.created_at,
  sa.success,sa.evidence_score,sa.first_try,sa.hint_level,sa.model_viewed,ps.title session_title,ps.mode session_mode
  FROM attempts a
  LEFT JOIN skill_attempts sa ON sa.attempt_id=a.id
  LEFT JOIN practice_sessions ps ON ps.id=a.session_id
  WHERE a.skill_id=? ORDER BY a.id DESC LIMIT 30`).all(id);
 const errors=db.prepare(`SELECT COALESCE(error_tag,'other') error,COUNT(*) count
  FROM attempts WHERE skill_id=? AND error_tag IS NOT NULL AND error_tag NOT IN ('none','assisted_success')
  GROUP BY error_tag ORDER BY count DESC`).all(id);
 res.json({skill:mastery,attempts,errors});
});

app.get("/api/errors/:tag",(req,res)=>{
 const tag=String(req.params.tag||"");
 if(!ERROR_TAGS.includes(tag)||tag==="none") return res.status(400).json({error:"Unknown error category"});
 const days=Math.max(1,Math.min(365,Number(req.query.days)||30));
 const cutoff="-"+days+" days";
 const attempts=db.prepare(`SELECT a.id,a.session_date,a.skill_id,a.prompt,a.answer,a.correct,a.error_tag,a.feedback,a.suggestion,a.better_sentence,a.created_at,
  sa.evidence_score,sa.first_try,sa.hint_level,sa.model_viewed,ps.title session_title,ps.mode session_mode
  FROM attempts a LEFT JOIN skill_attempts sa ON sa.attempt_id=a.id LEFT JOIN practice_sessions ps ON ps.id=a.session_id
  WHERE a.error_tag=? AND a.session_date>=date('now',?)
  ORDER BY a.id DESC LIMIT 100`).all(tag,cutoff);
 const bySkill=db.prepare(`SELECT skill_id,COUNT(*) count FROM attempts
  WHERE error_tag=? AND session_date>=date('now',?)
  GROUP BY skill_id ORDER BY count DESC`).all(tag,cutoff);
 res.json({tag,days,count:attempts.length,bySkill,attempts});
});

app.get("/api/practice-groups",(req,res)=>{
 const groups=db.prepare(`SELECT g.id,g.mode,g.skill_id,g.title,g.exercise_count,g.favorite,g.created_at,
  (SELECT COUNT(*) FROM practice_sessions s WHERE s.group_id=g.id) session_count,
  (SELECT id FROM practice_sessions s WHERE s.group_id=g.id AND s.status='in_progress' ORDER BY s.id DESC LIMIT 1) active_session_id,
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
 res.json({group:{...group,skillName:group.skill_id?(skillMap[group.skill_id]?.name||group.skill_id):null},exercises:decorateExerciseList(items.map(x=>JSON.parse(x.exercise_json)),currentStage())});
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
 const items=db.prepare("SELECT position,exercise_json,answer,correct,completed,attempt_count,hint_level,model_viewed,first_try_correct,independent_correct,last_feedback_json FROM practice_session_items WHERE session_id=? ORDER BY position").all(id)
  .map(r=>({...r,exercise:decorateExercisePlan(JSON.parse(r.exercise_json),currentStage()),feedback:r.last_feedback_json?JSON.parse(r.last_feedback_json):null}));
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
 const skill=String(req.query.skill||"").trim();
 const error=String(req.query.error||"").trim();
 const result=String(req.query.result||"all");
 const mode=String(req.query.mode||"").trim();
 const requestedDays=req.query.days===undefined?30:Number(req.query.days);
 const days=Math.max(0,Math.min(3650,Number.isFinite(requestedDays)?requestedDays:30));
 const where=["1=1"],params=[];
 if(skill){where.push("a.skill_id=?");params.push(skill);}
 if(error){where.push("a.error_tag=?");params.push(error);}
 if(result==="correct"||result==="incorrect"){where.push("a.correct=?");params.push(result==="correct"?1:0);}
 if(mode){where.push("COALESCE(ps.mode,a.exercise_type)=?");params.push(mode);}
 if(days>0){where.push("a.session_date>=date('now',?)");params.push("-"+days+" days");}
 const rows=db.prepare(`SELECT a.id,a.session_date,a.exercise_id,a.exercise_type,a.skill_id,a.prompt,a.answer,a.correct,a.error_tag,
  a.feedback,a.suggestion,a.better_sentence,a.created_at,a.session_id,a.session_position,a.lesson_id,
  sa.success,sa.evidence_score,sa.first_try,sa.hint_level,sa.model_viewed,
  ps.title session_title,ps.mode session_mode
  FROM attempts a
  LEFT JOIN skill_attempts sa ON sa.attempt_id=a.id
  LEFT JOIN practice_sessions ps ON ps.id=a.session_id
  WHERE ${where.join(" AND ")}
  ORDER BY a.id DESC LIMIT 300`).all(...params);
 const skills=db.prepare("SELECT DISTINCT skill_id FROM attempts WHERE skill_id IS NOT NULL ORDER BY skill_id").all().map(x=>x.skill_id);
 const errors=db.prepare("SELECT DISTINCT error_tag FROM attempts WHERE error_tag IS NOT NULL AND error_tag!='none' ORDER BY error_tag").all().map(x=>x.error_tag);
 const modes=db.prepare("SELECT DISTINCT COALESCE(ps.mode,a.exercise_type) mode FROM attempts a LEFT JOIN practice_sessions ps ON ps.id=a.session_id WHERE COALESCE(ps.mode,a.exercise_type) IS NOT NULL ORDER BY mode").all().map(x=>x.mode);
 res.json({attempts:rows,filters:{skill,error,result,mode,days},options:{skills,errors,modes}});
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

function englishWordTokens(text){
 return String(text||"").match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)||[];
}

function precheckStudentAnswer(answer,modelAnswer,lesson){
 const text=String(answer||"").trim();
 const words=englishWordTokens(text);
 const modelWords=englishWordTokens(modelAnswer||"");
 const stage=Number(lesson?.stage||1);
 const expectedMin=stage>=10?Math.max(4,Math.min(12,Math.ceil(modelWords.length*.35))):Math.max(2,Math.min(5,Math.ceil(modelWords.length*.45)));
 const letterCount=(text.match(/[A-Za-z]/g)||[]).length;
 const modelLetterCount=(String(modelAnswer||"").match(/[A-Za-z]/g)||[]).length;
 const tooShortByWords=words.length<expectedMin;
 const tooShortByContent=modelLetterCount>=12&&letterCount<Math.max(4,Math.floor(modelLetterCount*.22));
 if(!text||words.length===0||tooShortByWords||tooShortByContent){
  return {
   correct:false,
   meaning:"needs_work",
   grammar:"needs_work",
   tense:"not_applicable",
   capitalization:"needs_work",
   punctuation:"needs_work",
   feedback:"This is not a complete answer to the prompt yet.",
   suggestion:"Write a complete English sentence before checking. Aim for at least "+expectedMin+" meaningful English words for this exercise.",
   betterSentence:"",
   skillSuccess:false,
   errorTag:"incomplete_sentence",
   deterministicPrecheck:true
  };
 }
 return null;
}

app.post("/api/check",async(req,res)=>{
 try{
  const {exerciseId,prompt,answer,grammarFocus,modelAnswer,skillId,lessonId,exerciseType,sessionId,position,hintLevel=0,modelViewed=false}=req.body??{};
  if(exerciseId===undefined||!prompt||!answer||!skillId) return res.status(400).json({error:"exerciseId, prompt, answer and skillId are required"});
  const skill=skillMap[skillId];
  let resolvedLesson=lessonId?curriculumLesson(lessonId):null;
  if(!resolvedLesson) resolvedLesson=resolveExerciseLesson({skill:skillId},Math.max(currentStage(),skill?.stage||1));
  const resolvedLessonId=resolvedLesson?.id||null;
  const sessionItem=(sessionId!==undefined&&position!==undefined)?db.prepare("SELECT * FROM practice_session_items WHERE session_id=? AND position=?").get(Number(sessionId),Number(position)):null;
  const previousAttempts=sessionItem?.attempt_count||0;
  const firstTry=previousAttempts===0;
  const lessonRules=resolvedLesson?parseJsonArray(resolvedLesson.rules_json).join(" | "):"";
  const lessonErrors=resolvedLesson?parseJsonArray(resolvedLesson.common_errors_json).join(" | "):"";
  const instructions="You are a concise writing coach for an 11-year-old ESL student. Judge meaning and grammar, not exact wording. Accept natural alternatives. Evaluate the named target skill and assigned curriculum lesson separately. Capitalization or punctuation alone must not fail grammar/meaning. errorTag should be a short stable grammar category or 'none'. Keep feedback child-friendly. Follow the deterministic curriculum rule rather than inventing a new target.";
  const input="Prompt: "+prompt+"\nTarget skill: "+(skill?.name||skillId)+"\nCurriculum lesson: "+(resolvedLesson?.title||resolvedLessonId||"legacy")+"\nLesson objective: "+(resolvedLesson?.objective||"")+"\nLesson rules: "+lessonRules+"\nCommon target errors: "+lessonErrors+"\nFocus: "+(grammarFocus||"")+"\nStudent: "+answer+"\nReference only: "+(modelAnswer||"(none)")+"\nRequired JSON keys: correct(boolean), meaning(ok|needs_work), grammar(ok|needs_work), tense(ok|needs_work|not_applicable), capitalization(ok|needs_work), punctuation(ok|needs_work), feedback(string), suggestion(string), betterSentence(string), skillSuccess(boolean), errorTag(string).";
  const precheck=precheckStudentAnswer(answer,modelAnswer,resolvedLesson);
  const r=precheck||await runWritingCheck(input,instructions);
  r.errorTag=normalizeErrorTag(r.errorTag,r);
  let evidence=0;
  if(r.skillSuccess){
   if(modelViewed) evidence=.25;
   else if(Number(hintLevel)>=2) evidence=.45;
   else if(Number(hintLevel)===1) evidence=.65;
   else if(firstTry) evidence=1;
   else evidence=.8;
  }
  const info=db.prepare("INSERT INTO attempts(exercise_id,prompt,grammar_focus,answer,correct,meaning,grammar,tense,capitalization,punctuation,feedback,suggestion,better_sentence,skill_id,exercise_type,session_date,error_tag,session_id,session_position,lesson_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(String(exerciseId),prompt,grammarFocus||"",answer,r.correct?1:0,r.meaning,r.grammar,r.tense,r.capitalization,r.punctuation,r.feedback,r.suggestion,r.betterSentence,skillId,exerciseType||"practice",today(),r.errorTag,sessionId==null?null:Number(sessionId),position==null?null:Number(position),resolvedLessonId);
  const aid=Number(info.lastInsertRowid);
  db.prepare("INSERT INTO skill_attempts(attempt_id,skill_id,success,evidence_score,first_try,hint_level,model_viewed) VALUES(?,?,?,?,?,?,?)").run(aid,skillId,r.skillSuccess?1:0,evidence,firstTry?1:0,Number(hintLevel)||0,modelViewed?1:0);
  if(resolvedLessonId) db.prepare("INSERT INTO lesson_attempts(attempt_id,lesson_id,skill_id,success,evidence_score,first_try,hint_level,model_viewed) VALUES(?,?,?,?,?,?,?,?)").run(aid,resolvedLessonId,skillId,r.skillSuccess?1:0,evidence,firstTry?1:0,Number(hintLevel)||0,modelViewed?1:0);

  if(sessionItem){
   const newAttemptCount=previousAttempts+1;
   const firstTryCorrect=sessionItem.first_try_correct||(firstTry&&r.correct?1:0);
   const independentCorrect=sessionItem.independent_correct||(firstTry&&r.correct&&Number(hintLevel||0)===0&&!modelViewed?1:0);
   db.prepare("UPDATE practice_session_items SET answer=?,correct=?,completed=?,attempt_count=?,hint_level=?,model_viewed=?,first_try_correct=?,independent_correct=?,last_feedback_json=?,updated_at=CURRENT_TIMESTAMP WHERE session_id=? AND position=?")
    .run(answer,(r.correct||sessionItem.correct)?1:0,r.correct?1:sessionItem.completed,newAttemptCount,Math.max(sessionItem.hint_level,Number(hintLevel)||0),sessionItem.model_viewed||(modelViewed?1:0),firstTryCorrect,independentCorrect,JSON.stringify(r),Number(sessionId),Number(position));
   const stats=db.prepare("SELECT COUNT(*) total,SUM(completed) completed,SUM(correct) correct,SUM(first_try_correct) first_try_correct,SUM(independent_correct) independent_correct FROM practice_session_items WHERE session_id=?").get(Number(sessionId));
   const done=Number(stats.completed||0)>=Number(stats.total||0);
   db.prepare("UPDATE practice_sessions SET current_index=?,correct_count=?,first_try_correct=?,independent_correct=?,status=?,updated_at=CURRENT_TIMESTAMP,completed_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id=?")
    .run(Number(position),Number(stats.correct||0),Number(stats.first_try_correct||0),Number(stats.independent_correct||0),done?"completed":"in_progress",done?1:0,Number(sessionId));
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
 let ollamaAvailable=false,ollamaError="";
 try{await requestOllamaJson("/api/tags",{timeoutMs:1500});ollamaAvailable=true;}catch(e){ollamaError=e?.message||String(e);}
 res.json({
  llm_provider:llmProvider,
  ollama_available:ollamaAvailable,
  ollama_base_url:activeOllamaBaseUrl||configuredOllamaBaseUrl,
  ollama_candidates:ollamaCandidateUrls,
  ollama_error:ollamaError,
  ollama_writing_model:ollamaModel,
  ollama_check_timeout_seconds:Math.round(ollamaTimeoutMs/1000),
  ollama_generation_timeout_seconds:Math.round(ollamaGenerationTimeoutMs/1000),
  ollama_generation_batch_size:ollamaGenerationBatchSize,
  openai_enabled:Boolean(client),
  openai_model:openaiModel
 });
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
app.listen(port,host,async()=>{
 console.log("Writing Trainer running on "+host+":"+port);
 if(llmProvider==="ollama"||llmProvider==="auto"){
  try{
   const {base}=await requestOllamaJson("/api/tags",{timeoutMs:1200});
   console.log("[Ollama] Ready at "+base+" using model "+ollamaModel);
  }catch(e){
   console.warn("[Ollama] Not reachable yet. "+e.message);
  }
 }
});
