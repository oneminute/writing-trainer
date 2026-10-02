import express from "express";
import OpenAI from "openai";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const port = process.env.PORT || 5178;
const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "writing-trainer.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exercise_id INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    grammar_focus TEXT,
    answer TEXT NOT NULL,
    correct INTEGER NOT NULL DEFAULT 0,
    meaning TEXT,
    grammar TEXT,
    tense TEXT,
    capitalization TEXT,
    punctuation TEXT,
    feedback TEXT,
    suggestion TEXT,
    better_sentence TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_attempts_exercise
  ON attempts(exercise_id, created_at);

  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const saveAttempt = db.prepare(`
  INSERT INTO attempts (
    exercise_id, prompt, grammar_focus, answer, correct,
    meaning, grammar, tense, capitalization, punctuation,
    feedback, suggestion, better_sentence
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const setState = db.prepare(`
  INSERT INTO app_state(key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

const writingCheckSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    correct: { type: "boolean" },
    meaning: { type: "string", enum: ["ok", "needs_work"] },
    grammar: { type: "string", enum: ["ok", "needs_work"] },
    tense: { type: "string", enum: ["ok", "needs_work", "not_applicable"] },
    capitalization: { type: "string", enum: ["ok", "needs_work"] },
    punctuation: { type: "string", enum: ["ok", "needs_work"] },
    feedback: { type: "string" },
    suggestion: { type: "string" },
    betterSentence: { type: "string" }
  },
  required: [
    "correct", "meaning", "grammar", "tense", "capitalization",
    "punctuation", "feedback", "suggestion", "betterSentence"
  ]
};

app.get("/api/progress", (req, res) => {
  const rows = db.prepare(`
    SELECT a.*
    FROM attempts a
    INNER JOIN (
      SELECT exercise_id, MAX(id) AS max_id
      FROM attempts
      GROUP BY exercise_id
    ) latest ON latest.max_id = a.id
    ORDER BY a.exercise_id
  `).all();

  const solved = db.prepare(`
    SELECT DISTINCT exercise_id
    FROM attempts
    WHERE correct = 1
    ORDER BY exercise_id
  `).all().map(row => row.exercise_id);

  const stateRows = db.prepare("SELECT key, value FROM app_state").all();
  const state = Object.fromEntries(stateRows.map(row => [row.key, row.value]));

  res.json({ solved, latestAttempts: rows, state });
});

app.post("/api/state", (req, res) => {
  const { currentExercise } = req.body ?? {};
  if (Number.isInteger(currentExercise) && currentExercise >= 0) {
    setState.run("currentExercise", String(currentExercise));
  }
  res.json({ ok: true });
});

app.post("/api/check", async (req, res) => {
  try {
    const { exerciseId, prompt, answer, grammarFocus, modelAnswer } = req.body ?? {};
    if (!Number.isInteger(exerciseId) || !prompt || !answer) {
      return res.status(400).json({ error: "exerciseId, prompt and answer are required" });
    }

    const response = await client.responses.create({
      model,
      reasoning: { effort: "none" },
      max_output_tokens: 220,
      instructions:
        "You are a concise English writing coach for an 11-year-old ESL student. " +
        "Judge meaning and grammar, not exact wording. Accept natural alternatives. " +
        "Check the stated grammar focus carefully. Capitalization or punctuation alone " +
        "should not make grammar or meaning fail. Keep feedback short and child-friendly.",
      input:
        `Prompt: ${prompt}\n` +
        `Focus: ${grammarFocus || "general sentence writing"}\n` +
        `Student: ${answer}\n` +
        `Reference only: ${modelAnswer || "(none)"}`,
      text: {
        format: {
          type: "json_schema",
          name: "writing_check",
          strict: true,
          schema: writingCheckSchema
        }
      }
    });

    const result = JSON.parse(response.output_text);

    const info = saveAttempt.run(
      exerciseId, prompt, grammarFocus || "", answer, result.correct ? 1 : 0,
      result.meaning, result.grammar, result.tense, result.capitalization,
      result.punctuation, result.feedback, result.suggestion, result.betterSentence
    );
    setState.run("currentExercise", String(exerciseId));

    res.json({ ...result, attemptId: Number(info.lastInsertRowid) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error?.message || "OpenAI request failed" });
  }
});

app.listen(port, () => {
  console.log(`Writing Trainer running at http://localhost:${port}`);
});
