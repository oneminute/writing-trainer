# Writing Trainer v0.3

Writing Trainer is evolving from a sentence checker into an adaptive English-writing learning system.

## Learning loop

Curriculum → daily practice → OpenAI feedback → skill evidence → SQLite history → spaced review → progress/report → next practice.

## Curriculum

The curriculum is defined in `src/curriculum.js`, from basic sentence structure through independent school writing. Calendar days do not automatically unlock harder writing. Progress is based on skill evidence.

## Skill mastery

Each checked answer records evidence for its primary target skill. Recent attempts receive more weight. The UI shows Not started, Learning, Improving, Stable, or Mastered.

## Review

Incorrect target skills enter a spaced review queue. Successful reviews move through approximately 1, 3, 7, and 14 day intervals. The goal is to test the rule again in new sentences rather than memorize one answer.

## Daily practice

The initial 12-item set contains foundation, mixed, school-life, and transfer exercises. The next milestone is dynamic AI generation using the planner proportions: review + weak skills + current curriculum target + mixed transfer + independent writing.

## Pages

- **Today** — focused practice and end-of-day report
- **Review** — skills due for spaced review
- **Progress** — curriculum mastery map
- **History** — previous sentences and feedback

## Windows

Double-click `start-writing-trainer.bat`. The local app runs at http://localhost:5178.

SQLite data is stored in `data/writing-trainer.db` and is ignored by Git.
