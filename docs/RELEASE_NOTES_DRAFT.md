# Draft Release Notes — Writing Trainer 0.2.x Public Beta

> Draft only. Use this as the basis for the first tagged public release after the license and clean-install checks are complete.

## Writing Trainer

A local-first adaptive English writing trainer for ESL learners.

The main architectural principle is simple:

**The LLM does not control the curriculum.**

Writing Trainer combines a deterministic 12-stage / 52-lesson curriculum with local AI exercise generation, lesson-specific grading rubrics, mastery evidence, spaced review, and persistent SQLite learning history.

## Highlights

### Deterministic curriculum

The curriculum is authored in code and seeded into SQLite.

Each lesson includes:

- objective
- grammar rules
- common errors
- required elements
- prompt-pattern examples
- difficulty guidance
- explicit exclusions

The language model receives the lesson specification but does not choose the learning path.

### Local-first generation

The default workflow uses Ollama + Qwen.

The server can auto-detect local Ollama endpoints on:

- configured `OLLAMA_BASE_URL`
- `127.0.0.1:12000`
- `127.0.0.1:11434`

Exercise generation is split into small batches for better reliability on local 9B-class models.

### Rubric-based grading

Answers are evaluated against:

1. meaning coverage
2. assigned lesson target
3. grammar
4. tense
5. capitalization
6. punctuation

The model answer is treated as one valid reference rather than an exact-match key.

The server also performs deterministic incomplete-answer checks and normalizes contradictory model judgments.

### Persistent learning history

Writing Trainer stores:

- attempts
- hints used
- model-answer usage
- first-try correctness
- independent correctness
- lesson mastery
- skill mastery
- review queue
- saved practice sets
- resumable sessions

### Practice Sets

Generated practice is archived instead of discarded.

Users can:

- replay old sets
- resume unfinished sets
- rename sets
- favorite sets
- inspect previous questions

### Progress and History

The Progress page includes:

- current stage
- stage blockers
- independent accuracy
- recent sessions
- error categories
- lesson and skill mastery

History supports filtering by time, practice mode, skill, error category, and result.

## Installation

Windows is currently the best-supported platform.

See the README Quick Start section.

## Known limitations

- pre-1.0 UX
- Windows-first launch workflow
- no finalized repository license yet
- curriculum currently optimized for a middle-school ESL learner
- local model quality varies by hardware and model
- paragraph and school-style writing modes are still being expanded

## Feedback wanted

Especially useful feedback includes:

- grading edge cases
- ESL curriculum sequencing
- mastery evidence weighting
- local-model compatibility
- progress-report clarity
- transition from translation support to independent writing

## Before publishing this release

- [ ] choose and add LICENSE
- [ ] verify fresh clone on a clean Windows environment
- [ ] capture 4 polished screenshots
- [ ] verify no private learner data or credentials are included
- [ ] update version number if desired
- [ ] tag release
