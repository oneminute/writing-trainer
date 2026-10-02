# Writing Trainer

A local web app for sentence-by-sentence English writing practice with OpenAI-powered feedback and SQLite progress storage.

## Windows: easiest way to run

Double-click:

`start-writing-trainer.bat`

The launcher will:

1. Check that Node.js is installed.
2. Create `.env` from `.env.example` on first run.
3. Open `.env` so you can enter your OpenAI API key.
4. Run `npm install` automatically when dependencies are missing.
5. Start the app on port **5178**.
6. Open http://localhost:5178 in your browser.

After the first setup, normally you only need to double-click the BAT file.

## Data storage

The app automatically creates:

`data/writing-trainer.db`

This SQLite database stores every checked sentence, AI feedback, correctness, exercise progress, and the last exercise position.

The `data/` directory and SQLite files are ignored by Git, so local student history is not committed to the public repository.

## AI checking

The server uses the OpenAI Responses API with structured output. The default model is configured in `.env`:

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6-luna
PORT=5178
```

The API key remains server-side and is never sent to browser JavaScript.

## Manual start

```powershell
npm install
npm start
```

Then open http://localhost:5178.

## Stored attempt fields

Each check records the exercise, student's sentence, correctness, meaning, grammar, tense, capitalization, punctuation, feedback, suggestion, improved sentence, and timestamp.

This history is intended to support future features such as repeated-error analysis, review exercises, and automatic daily difficulty adjustment.
