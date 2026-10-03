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
for (const [name,type] of [["skill_id","TEXT"],["exercise_type","TEXT"],["session_date","TEXT"]]) {
  if (!cols.includes(name)) db.exec(`ALTER TABLE attempts ADD COLUMN ${name} ${type}`);
}
db.exec("CREATE INDEX IF NOT EXISTS idx_skill_attempts_skill ON skill_attempts(skill_id, created_at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_attempts_date ON attempts(session_date, id)");

const today = () => new Date().toLocaleDateString("en-CA");
const addDays = n => { const d=new Date(); d.setDate(d.getDate()+n); return d.toLocaleDateString("en-CA"); };
const setState=db.prepare("INSERT INTO app_state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");

app.use(express.json({limit:"32kb"}));
app.use(express.static(path.join(__dirname,"public")));

const schema={type:"object",additionalProperties:false,properties:{
 correct:{type:"boolean"},meaning:{type:"string",enum:["ok","needs_work"]},
 grammar:{type:"string",enum:["ok","needs_work"]},tense:{type:"string",enum:["ok","needs_work","not_applicable"]},
 capitalization:{type:"string",enum:["ok","needs_work"]},punctuation:{type:"string",enum:["ok","needs_work"]},
 feedback:{type:"string"},suggestion:{type:"string"},betterSentence:{type:"string"},
 skillSuccess:{type:"boolean"},errorTag:{type:"string"}
},required:["correct","meaning","grammar","tense","capitalization","punctuation","feedback","suggestion","betterSentence","skillSuccess","errorTag"]};

function masteryRows(){
 return SKILLS.map(s=>{
   const rows=db.prepare("SELECT success FROM skill_attempts WHERE skill_id=? ORDER BY id DESC LIMIT 8").all(s.id);
   if(!rows.length) return {...s,score:0,attempts:0,status:"Not started"};
   const weights=rows.map((_,i)=>Math.max(1,8-i));
   const score=Math.round(rows.reduce((a,r,i)=>a+r.success*weights[i],0)/weights.reduce((a,b)=>a+b,0)*100);
   return {...s,score,attempts:rows.length,status:statusFromMastery(score,rows.length)};
 });
}

function currentStage(mastery){
 for(let stage=1;stage<=12;stage++){
   const relevant=mastery.filter(x=>x.stage===stage);
   if(relevant.length && relevant.some(x=>x.status!=="Mastered" && x.score<75)) return stage;
 }
 return 12;
}

app.get("/api/today",(req,res)=>{
 const date=today();
 db.prepare("INSERT OR IGNORE INTO daily_sessions(session_date) VALUES (?)").run(date);
 const mastery=masteryRows();
 const due=db.prepare("SELECT * FROM review_queue WHERE due_date<=? ORDER BY due_date LIMIT 4").all(date);
 res.json({date,stage:currentStage(mastery),exercises:BASE_EXERCISES,dueReviews:due,mastery});
});

app.get("/api/progress",(req,res)=>{
 const mastery=masteryRows();
 const totals=db.prepare("SELECT COUNT(*) attempts, SUM(correct) correct FROM attempts").get();
 res.json({mastery,stage:currentStage(mastery),totals});
});

app.get("/api/history",(req,res)=>{
 const rows=db.prepare(`SELECT id,session_date,exercise_id,exercise_type,skill_id,prompt,answer,correct,
 feedback,suggestion,better_sentence,created_at FROM attempts ORDER BY id DESC LIMIT 200`).all();
 res.json({attempts:rows});
});

app.get("/api/review",(req,res)=>{
 const rows=db.prepare("SELECT * FROM review_queue WHERE due_date<=? ORDER BY due_date, skill_id").all(today());
 res.json({reviews:rows});
});

app.get("/api/report",(req,res)=>{
 const date=String(req.query.date||today());
 const rows=db.prepare("SELECT * FROM attempts WHERE session_date=? ORDER BY id").all(date);
 const skillRows=db.prepare(`SELECT sa.skill_id, COUNT(*) attempts, SUM(sa.success) successes
 FROM skill_attempts sa JOIN attempts a ON a.id=sa.attempt_id WHERE a.session_date=? GROUP BY sa.skill_id`).all(date);
 const strong=skillRows.filter(x=>x.successes/x.attempts>=.8).map(x=>skillMap[x.skill_id]?.name||x.skill_id);
 const weak=skillRows.filter(x=>x.successes/x.attempts<.8).map(x=>skillMap[x.skill_id]?.name||x.skill_id);
 res.json({date,attempts:rows.length,correct:rows.filter(x=>x.correct).length,strong,weak,
 mistakes:rows.filter(x=>!x.correct).slice(-5).map(x=>({answer:x.answer,feedback:x.feedback,better:x.better_sentence}))});
});

app.post("/api/state",(req,res)=>{
 const n=req.body?.currentExercise;
 if(Number.isInteger(n)&&n>=0)setState.run("currentExercise",String(n));
 res.json({ok:true});
});

app.post("/api/check",async(req,res)=>{
 try{
  const {exerciseId,prompt,answer,grammarFocus,modelAnswer,skillId,exerciseType}=req.body??{};
  if(exerciseId===undefined||!prompt||!answer||!skillId)return res.status(400).json({error:"exerciseId, prompt, answer and skillId are required"});
  const skill=skillMap[skillId];
  const instructions="You are a concise writing coach for an 11-year-old ESL student. Judge meaning and grammar, not exact wording. Accept natural alternatives. Evaluate the named target skill separately. Capitalization or punctuation alone must not fail grammar/meaning. errorTag should be a short grammar category or 'none'. Keep feedback child-friendly.";
  const input=`Prompt: ${prompt}\nTarget skill: ${skill?.name||skillId}\nFocus: ${grammarFocus||""}\nStudent: ${answer}\nReference only: ${modelAnswer||"(none)"}\nRequired JSON keys: correct(boolean), meaning(ok|needs_work), grammar(ok|needs_work), tense(ok|needs_work|not_applicable), capitalization(ok|needs_work), punctuation(ok|needs_work), feedback(string), suggestion(string), betterSentence(string), skillSuccess(boolean), errorTag(string).`;
  const r=await runWritingCheck(input,instructions);
  const info=db.prepare(`INSERT INTO attempts(exercise_id,prompt,grammar_focus,answer,correct,meaning,grammar,tense,capitalization,punctuation,feedback,suggestion,better_sentence,skill_id,exercise_type,session_date)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(String(exerciseId),prompt,grammarFocus||"",answer,r.correct?1:0,r.meaning,r.grammar,r.tense,r.capitalization,r.punctuation,r.feedback,r.suggestion,r.betterSentence,skillId,exerciseType||"practice",today());
  const aid=Number(info.lastInsertRowid);
  db.prepare("INSERT INTO skill_attempts(attempt_id,skill_id,success) VALUES(?,?,?)").run(aid,skillId,r.skillSuccess?1:0);
  const q=db.prepare("SELECT * FROM review_queue WHERE skill_id=?").get(skillId);
  if(r.skillSuccess){
    if(q){
      const streak=q.streak+1;
      if(streak>=4) db.prepare("DELETE FROM review_queue WHERE skill_id=?").run(skillId);
      else db.prepare("UPDATE review_queue SET due_date=?,streak=?,updated_at=CURRENT_TIMESTAMP WHERE skill_id=?").run(addDays(nextReviewDays(streak)),streak,skillId);
    }
  }else{
    db.prepare(`INSERT INTO review_queue(skill_id,due_date,streak,last_error) VALUES(?,?,0,?)
      ON CONFLICT(skill_id) DO UPDATE SET due_date=excluded.due_date,streak=0,last_error=excluded.last_error,updated_at=CURRENT_TIMESTAMP`).run(skillId,addDays(1),r.errorTag);
  }
  res.json({...r,attemptId:aid});
 }catch(e){console.error(e);res.status(500).json({error:e?.message||"OpenAI request failed"});}
});

app.get("/api/health",async(req,res)=>{
 let ollamaAvailable=false;
 try{
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),1500);
  const r=await fetch(`${ollamaBaseUrl}/api/tags`,{signal:c.signal}); clearTimeout(t);
  ollamaAvailable=r.ok;
 }catch{}
 res.json({llm_provider:llmProvider,ollama_available:ollamaAvailable,ollama_base_url:ollamaBaseUrl,ollama_writing_model:ollamaModel,openai_enabled:Boolean(client),openai_model:openaiModel});
});

app.post("/api/complete-day",(req,res)=>{
 const date=today();
 db.prepare("INSERT OR IGNORE INTO daily_sessions(session_date) VALUES (?)").run(date);
 db.prepare("UPDATE daily_sessions SET completed=1,completed_at=CURRENT_TIMESTAMP WHERE session_date=?").run(date);
 res.json({ok:true,date});
});

const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => console.log(`Writing Trainer running on ${host}:${port}`));
