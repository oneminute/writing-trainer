# Demo Capture Guide

The first public demo should prove the product in under one minute.

## Screenshot set

Capture four screenshots at a consistent browser size.

### 1. Today — curriculum context

Show one question with Stage, Lesson, Skill, Practice target, prompt, answer box, and Check / Hint / Model answer controls.

Message: every generated sentence belongs to an explicit curriculum lesson.

### 2. Plan — deterministic lesson specification

Expand one lesson so the screenshot shows objective, rules, common errors, prompt patterns, required elements, avoid, and difficulty.

Message: the LLM does not invent the curriculum.

### 3. Progress — evidence, not just score

Show current stage, blocker lessons, independent accuracy, recent sessions, error patterns, and mastery bars.

Message: the trainer remembers how the answer was produced, not only whether it ended correct.

### 4. Sets — persistence

Show several saved practice sets, including one with Resume.

Message: generated practice is reusable learning material, not disposable AI output.

## 45-second demo

0–6s: Open Today. Caption: "A local-first ESL writing trainer with a deterministic curriculum."

6–14s: Point to Stage / Lesson / Skill. Caption: "The model receives an exact lesson. It doesn't decide what the learner studies."

14–22s: Enter a deliberately wrong answer and click Check. Caption: "Grading uses the lesson objective, grammar rules, required meaning, and a structured rubric."

22–28s: Use Hint. Caption: "Assisted success is tracked separately from independent success."

28–35s: Open Plan and expand the lesson. Caption: "All teaching rules are inspectable."

35–41s: Open Progress. Caption: "Errors and lesson mastery persist over time."

41–45s: Open Sets. Caption: "Every generated set can be resumed or practiced again."

End card:

github.com/oneminute/writing-trainer

Local-first · Ollama/Qwen · SQLite

## Recording safety

Before recording:

- use a clean demo database
- remove learner names and real school information
- hide local configuration files
- never show credentials
- avoid terminal windows containing private paths if unnecessary

## Demo data

Use fictional generic school-life examples such as:

- "My classmates are happy today."
- "He didn't watch TV last night."
- "I finished my science homework yesterday."
