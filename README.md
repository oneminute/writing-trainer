# Writing Trainer

A web app for sentence-by-sentence English writing practice.

The browser provides the exercise UI. A Node/Express backend sends the student's sentence to the OpenAI Responses API for semantic and grammar evaluation, so correct alternative wording can be accepted instead of relying on fragile string matching.

## Features

- One-sentence writing exercises
- Grammar focus for each exercise
- Three-level hints
- Model answer
- AI evaluation of meaning, grammar, tense, capitalization, and punctuation
- Short correction advice and a better example sentence
- API key stays on the server

## Run locally

1. Install Node.js 20+.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Put your OpenAI API key in `.env`.
5. Run `npm run dev`.
6. Open http://localhost:3000

### Windows PowerShell

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

## Environment

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6
PORT=3000
```

Never commit your real API key.

## Architecture

Browser -> POST /api/check -> Express server -> OpenAI Responses API -> structured feedback

## Next steps

- Move daily exercise sets into JSON files
- Track repeated grammar mistakes
- Add paragraph writing
- Add parent progress view
- Add configurable difficulty and grammar targets
