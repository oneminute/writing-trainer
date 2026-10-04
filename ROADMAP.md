# Roadmap

Writing Trainer is a pre-1.0 project. The roadmap prioritizes learning reliability before feature breadth.

## Now — reliability and public beta readiness

- [x] Deterministic 12-stage curriculum
- [x] Detailed lesson guidance stored in SQLite
- [x] Local Qwen exercise generation
- [x] Optional OpenAI provider
- [x] Lesson-specific grading rubric
- [x] Deterministic incomplete-answer checks
- [x] Practice-set archive and replay
- [x] Persistent sessions and resume
- [x] Skill and lesson mastery
- [x] Spaced review queue
- [x] Progress dashboard
- [x] History filters and error drill-down
- [x] Historical prompt deduplication
- [x] Isolated SQLite/API smoke tests
- [ ] Expand regression tests for grading edge cases
- [ ] Add better user-visible model connection diagnostics
- [ ] Add import/export / backup for learning data
- [ ] Add database migration versioning
- [x] License repository under Apache-2.0
- [ ] Capture polished screenshots and short demo GIF

## Next — writing progression

The most important product goal is moving beyond one-sentence translation.

### Stage-aware response modes

- [ ] 2 connected sentences
- [ ] 3–4 sentence mini-paragraphs
- [ ] 5–7 sentence paragraphs
- [ ] English-first prompts
- [ ] school-style short constructed responses

### Better revision workflow

- [ ] distinguish first draft from revised draft
- [ ] compare changes between revisions
- [ ] detect whether feedback was actually addressed
- [ ] encourage revision before showing a model answer
- [ ] paragraph-level organization feedback

## Adaptive learning v3

- [ ] deterministic daily slot allocation by lesson, not only skill
- [ ] weak-lesson prioritization
- [ ] transfer tasks that combine mastered lessons
- [ ] configurable review ratios
- [ ] configurable mastery strictness
- [ ] confidence / evidence visualization
- [ ] separate "learned once" from "retained over time"
- [ ] lesson-specific review intervals

## Parent / teacher experience

- [ ] parent-facing weekly report
- [ ] trend summaries
- [ ] "what changed this week" view
- [ ] explain why a lesson is being assigned
- [ ] printable/exportable progress summary
- [ ] multiple learner profiles
- [ ] optional teacher-created custom lesson packs

## Local AI

- [ ] model benchmark page
- [ ] configurable model per task
- [ ] smaller fast grader option
- [ ] larger generator option
- [ ] model latency statistics
- [ ] prompt / response debug view
- [ ] graceful model hot-swap
- [ ] additional local providers beyond Ollama

## Platform

- [ ] macOS launcher documentation
- [ ] Linux launcher documentation
- [ ] Docker option
- [ ] application packaging
- [ ] mobile-friendly learner UI
- [ ] accessibility review
- [ ] localization of parent-facing UI

## Public launch

- [x] README 2.0
- [x] Architecture documentation
- [x] Contribution guide
- [x] Security policy
- [x] Public roadmap
- [x] Promotion copy
- [ ] Add repository description and topics
- [x] Add Apache-2.0 license
- [ ] Record 30–60 second demo
- [ ] Publish first tagged release
- [ ] Show HN post
- [ ] Local-LLM community post
- [ ] ESL / education community feedback round

## Longer-term research questions

- How should mastery combine correctness, independence, retention, and transfer?
- How much lesson-level determinism is necessary before model creativity becomes useful?
- Can a small local model grade reliably when the rubric is highly structured?
- What is the best way to measure independent writing growth without overfitting to generated prompts?
- How should an adaptive writing system transition away from translation support?
