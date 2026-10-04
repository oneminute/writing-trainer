# Contributing

Thanks for helping improve Writing Trainer.

This project combines language-model engineering with an explicit learning curriculum, so changes should preserve both software correctness and pedagogical intent.

## Good contribution areas

Contributions are especially useful in:

- grading regression cases
- ESL curriculum corrections
- lesson prompt improvements
- local-model compatibility
- Ollama reliability
- SQLite migration safety
- UI / accessibility
- progress analytics
- test coverage
- documentation

## Before changing curriculum behavior

Please distinguish between:

1. **Curriculum control** — what the learner should study
2. **Exercise realization** — how the model phrases a specific exercise

Curriculum control should remain deterministic.

Do not move lesson selection, progression rules, or mastery policy into the LLM prompt just because it is easier to prototype.

## Local setup

```powershell
git clone https://github.com/oneminute/writing-trainer.git
cd writing-trainer
npm install
Copy-Item .env.example .env
npm test
npm start
```

For local Ollama:

```powershell
$env:OLLAMA_HOST="127.0.0.1:12000"
ollama serve
```

## Tests

Run:

```powershell
npm test
```

before opening a pull request.

The smoke test uses an isolated temporary SQLite database and should not modify real learner data.

## Grading bugs

Grading regressions are high-priority issues.

A useful grading bug report includes:

- exercise prompt
- curriculum lesson
- model/reference answer
- student answer
- actual judgment
- expected judgment
- model/provider used
- whether a hint or model answer was viewed

When possible, add the case to an automated regression test.

## Curriculum changes

For a curriculum lesson change, explain:

- what learner error the lesson targets
- why the existing rule is insufficient
- whether the change affects progression
- example good answers
- example common mistakes
- whether older saved exercises remain valid

Curriculum changes belong primarily in `src/plan.js`.

## Pull requests

Keep pull requests focused.

A good PR description should include:

- problem
- approach
- behavior before
- behavior after
- tests performed
- screenshots for UI changes

Avoid mixing unrelated refactors with curriculum changes.

## Data safety

Do not commit:

- `.env`
- API keys
- real learner databases
- private student information
- exported practice history containing personal information

The `data/` directory is gitignored.

## Coding style

The current codebase intentionally uses a small dependency footprint.

Prefer:

- simple readable JavaScript
- deterministic server-side validation
- explicit SQLite queries
- minimal new dependencies
- testable behavior

Avoid adding framework complexity unless it solves a demonstrated problem.

## AI-generated contributions

AI-assisted code is welcome, but contributors remain responsible for:

- correctness
- license compatibility
- tests
- security
- curriculum quality
- avoiding fabricated APIs or assumptions

## License

Writing Trainer is licensed under the Apache License 2.0.

Unless you explicitly state otherwise, contributions intentionally submitted for inclusion in the project are provided under the same Apache-2.0 terms, consistent with the license's contribution provisions.
