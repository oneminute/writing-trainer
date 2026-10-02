import express from "express";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const port = process.env.PORT || 3000;
const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

app.post("/api/check", async (req, res) => {
  try {
    const { prompt, answer, grammarFocus, modelAnswer } = req.body ?? {};
    if (!prompt || !answer) {
      return res.status(400).json({ error: "prompt and answer are required" });
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

    res.json(JSON.parse(response.output_text));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error?.message || "OpenAI request failed" });
  }
});

app.listen(port, () => {
  console.log(`Writing Trainer running at http://localhost:${port}`);
});
