import express from "express";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const port = process.env.PORT || 3000;
const model = process.env.OPENAI_MODEL || "gpt-5.6";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/check", async (req, res) => {
  try {
    const { prompt, answer, grammarFocus, modelAnswer } = req.body ?? {};
    if (!prompt || !answer) {
      return res.status(400).json({ error: "prompt and answer are required" });
    }

    const response = await client.responses.create({
      model,
      instructions: [
        "You are an English writing coach for an 11-year-old sixth-grade ESL student.",
        "Evaluate the student's answer by meaning and grammar, not exact wording.",
        "Accept natural alternative wording when it correctly expresses the prompt.",
        "Be especially careful with tense, subject-verb agreement, articles, pronouns, singular/plural, prepositions, auxiliaries, clauses, capitalization, and punctuation.",
        "Do not mark a correct sentence wrong just because it differs from the model answer.",
        "Keep explanations short, concrete, and child-friendly.",
        "Return ONLY valid JSON with this exact shape:",
        '{"correct":boolean,"meaning":"ok|needs_work","grammar":"ok|needs_work","tense":"ok|needs_work|not_applicable","capitalization":"ok|needs_work","punctuation":"ok|needs_work","feedback":"string","suggestion":"string","betterSentence":"string"}'
      ].join("\n"),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Chinese prompt: ${prompt}`,
                `Grammar focus: ${grammarFocus || "general sentence writing"}`,
                `Student answer: ${answer}`,
                `One possible model answer: ${modelAnswer || "(none)"}`,
                "",
                "Judge the student's sentence independently. The model answer is only a reference."
              ].join("\n")
            }
          ]
        }
      ]
    });

    let parsed;
    try {
      parsed = JSON.parse(response.output_text);
    } catch {
      return res.status(502).json({ error: "Unexpected model response format", raw: response.output_text });
    }
    res.json(parsed);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error?.message || "OpenAI request failed" });
  }
});

app.listen(port, () => {
  console.log(`Writing Trainer running at http://localhost:${port}`);
});
