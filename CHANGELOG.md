# Changelog

This project is pre-1.0 and evolving quickly.

## Unreleased

### Added

- deterministic 12-stage / 52-lesson writing curriculum
- curriculum seeding into SQLite
- lesson-level mastery evidence
- explicit lesson metadata on every practice question
- lesson-specific generation guidance
- lesson-specific grading rubric
- deterministic incomplete-answer precheck
- server-side grading consistency normalization
- persistent practice sessions
- saved practice groups and replay
- Resume for unfinished sets
- configurable practice count
- Progress dashboard
- filtered History
- error taxonomy and drill-down
- spaced review queue
- historical-prompt deduplication
- Ollama endpoint auto-detection
- batched local exercise generation
- isolated API / SQLite smoke tests
- public-facing architecture, roadmap, contribution, security, and promotion docs

### Changed

- stage progression now depends on detailed lesson evidence
- Today no longer reuses starter exercises after onboarding
- generated Today sets remain stable even if mastery changes later in the day
- local generation uses a separate timeout from grading
- mastery distinguishes independent and assisted success
- model answers are treated as references rather than exact-match keys

### Fixed

- short nonsense answers such as `ki` could be judged correct by a model
- feedback from a previous question could appear after moving to the next question
- delayed autosave could leak across question boundaries
- old starter prompts could reappear on later days
- Ollama failures previously surfaced as a generic `fetch failed`
- regenerated sets could be invalidated when the live planner changed

## 0.2.0

Early adaptive trainer baseline:

- Express server
- browser UI
- SQLite persistence
- OpenAI grading
- basic curriculum skills
- Today / Review / Progress / History pages
