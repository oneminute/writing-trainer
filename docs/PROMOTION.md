# Promotion Pack

This document contains reusable launch copy for different audiences.

The messaging should stay consistent:

> Writing Trainer is a local-first adaptive ESL writing trainer with a deterministic curriculum. The LLM generates exercises and interprets answers, but it does not control the curriculum or progression.

## One-line description

**Local-first adaptive English writing practice with a deterministic curriculum, local Qwen generation, rubric-based grading, spaced review, and persistent learning history.**

Shorter version:

**A deterministic-curriculum writing trainer powered by local AI.**

## Repository description

Suggested GitHub repository description:

> Local-first adaptive ESL writing trainer: deterministic curriculum, Ollama/Qwen exercise generation, rubric grading, mastery tracking, spaced review, and SQLite history.

## Suggested GitHub topics

```text
education
edtech
esl
english-learning
writing
writing-assistant
ollama
qwen
local-llm
local-ai
sqlite
adaptive-learning
spaced-repetition
ai-tutor
nodejs
```

## Core message

Avoid positioning this as "ChatGPT for English practice."

Use this framing instead:

> The interesting part is not that an LLM can generate exercises. The interesting part is controlling the LLM with a deterministic curriculum, explicit lesson rubrics, persistent evidence, and review scheduling.

## Show HN

### Suggested title

**Show HN: Writing Trainer – a local-first ESL tutor where the LLM doesn't control the curriculum**

### Draft

I built Writing Trainer because I wanted an AI writing tutor that did not improvise the learner's curriculum every time it ran.

The core architecture is deliberately split:

- a deterministic 12-stage / 52-lesson curriculum decides what should be learned
- a planner selects the lesson
- a local Qwen model generates varied exercises from the exact lesson specification
- grading uses the same lesson rules and a structured rubric
- SQLite stores attempts, hints, model-answer usage, mastery evidence, saved practice sets, and spaced review

The model is not allowed to decide progression.

A "correct" answer is also not automatically strong mastery evidence. The system distinguishes independent first-try success from answers completed after hints or after opening the model answer.

The default setup uses Ollama + Qwen locally. OpenAI is optional.

Another design goal was persistence: generated sets are saved, unfinished practice can be resumed, and old sets can be replayed without another model call.

The project is still pre-1.0. The current curriculum is aimed at a middle-school ESL learner, starting with sentence foundations and gradually moving toward connected writing, paragraph writing, and school-style responses.

Repo:
https://github.com/oneminute/writing-trainer

I'm especially interested in feedback on:

1. mastery / evidence weighting
2. deterministic curriculum vs model autonomy
3. grading reliability with small local models
4. how to transition from translation support to independent writing

Writing Trainer is open source under the Apache License 2.0.

## Reddit — Local LLM / Ollama audience

### Suggested title

**I stopped letting the local LLM decide the curriculum in my ESL writing tutor**

### Draft

I've been building a local-first English writing trainer around Ollama and Qwen3.5-9B.

The main lesson from the project so far is that "just prompt the model to be a tutor" is not stable enough.

I ended up moving almost all educational control out of the model:

- 12 deterministic stages
- 52 detailed lessons
- explicit grammar rules
- common error patterns
- required elements
- prompt constraints
- deterministic stage progression
- spaced review
- mastery evidence based on independence

Qwen now gets a very narrow task:

> Generate this exact lesson at this difficulty, using these rules, avoiding these errors, and return structured JSON.

For grading, the model receives the same lesson objective plus a rubric. The server then normalizes contradictory judgments and rejects obviously incomplete answers before the LLM is called.

Everything is stored in SQLite, including saved practice sets and sessions.

I'm running it locally through Ollama. Exercise generation is batched because asking a 9B model to generate 12–20 structured exercises in one response was too slow and unreliable.

Repo:
https://github.com/oneminute/writing-trainer

I'd be interested in how other people are handling small-model grading reliability and structured-generation constraints.

## Reddit — ESL / education audience

### Suggested title

**Building a writing practice tool that remembers a learner's mistakes instead of generating random exercises**

### Draft

I've been building a writing trainer for ESL learners with a different approach from most AI practice tools.

The AI does not decide what to teach.

There is a fixed curriculum with stages and individual lessons. The AI only creates new exercises for the selected lesson and grades the response against an explicit lesson rubric.

The system keeps a long-term record of:

- answers
- repeated mistakes
- hints used
- whether the learner opened the model answer
- independent vs assisted success
- lesson mastery
- review timing

Old exercises are saved and can be practiced again.

The current path starts with controlled sentence writing and is designed to gradually move toward connected sentences, short paragraphs, and school-style writing.

It's still under active development, but I'd really value feedback from ESL teachers/parents on the progression and feedback style.

Repo:
https://github.com/oneminute/writing-trainer

## X / Twitter

### Short post

I'm building Writing Trainer, a local-first ESL writing tutor.

The LLM does **not** control the curriculum.

12 stages → 52 deterministic lessons → exact lesson prompt → local Qwen exercise generation → rubric grading → mastery evidence → spaced review.

SQLite keeps the learning history and saved practice sets.

https://github.com/oneminute/writing-trainer

### Thread opener

Most AI tutors start with:

```text
"Act as an English teacher..."
```

I ended up doing the opposite.

I removed curriculum control from the LLM.

## LinkedIn

I've been building an adaptive English writing trainer around a simple architectural principle: **probabilistic language models should not own deterministic educational decisions.**

Writing Trainer uses a fixed 12-stage, 52-lesson curriculum. A planner selects the lesson; a local Qwen model generates exercise wording from that exact specification; grading uses the same lesson objective and a structured rubric; mastery evidence and review timing are handled by deterministic application logic.

The system also records whether a response was independent, revised after feedback, completed with hints, or completed after viewing a model answer.

The default setup is local-first with Ollama + Qwen and SQLite persistence.

The interesting problem has become less "Can an LLM generate English exercises?" and more "How much authority should the model have inside a learning system?"

Project:
https://github.com/oneminute/writing-trainer

## 中文：V2EX / 掘金 / 技术社区

### 标题

**我做了一个本地 AI 英语写作训练器，但不让大模型决定课程内容**

### 正文

最近在做一个英语写作训练项目 Writing Trainer。

一开始也走过很常见的路线：给模型一段 prompt，让它自己出题、自己批改、自己决定下一步练什么。

实际用下来发现，这种方式看起来很智能，但作为长期学习系统不够稳定：

- 今天和明天课程顺序可能不一样
- 模型容易重复出相似题
- 批改标准会漂移
- 一道题做对了，不知道是独立会做还是看了提示以后才会
- 模型很难稳定记住过去几周具体错过什么

所以后来把架构反过来了。

现在系统里：

- 12 个固定 Stage
- 52 个详细 Lesson
- 每个 Lesson 明确写 grammar rules
- common errors
- required elements
- prompt pattern
- difficulty
- avoid rules

这些全部由程序和 SQLite 管理，不由 Qwen 决定。

Qwen 只做两件事：

1. 按指定 Lesson 生成自然的新练习
2. 按同一个 Lesson rubric 判断孩子的答案

除此之外：

- 本地 Ollama + Qwen3.5-9B
- SQLite 长期保存学习历史
- 自动复习
- Mastery 区分独立答对 / 修改后答对 / Hint 后答对 / 看答案后答对
- 每套生成的练习永久保存
- 可以 Resume 和 Practice Again
- 历史错误可以按类别查看

项目：
https://github.com/oneminute/writing-trainer

现在还在 pre-1.0 阶段，我比较想听大家对两个问题的意见：

1. 小模型做英语批改，怎样设计 rubric 才能更稳定？
2. adaptive learning 里，LLM 到底应该拥有多少决策权？

## 中文：家长 / 教育用户

我最近在做一个英语写作练习工具，重点不是让 AI 随机给孩子出题，而是让练习真正形成长期学习记录。

它会记录：

- 哪些语法已经掌握
- 哪些错误反复出现
- 是第一次独立写对，还是提示后才写对
- 是否看过参考答案
- 哪些内容到了该复习的时间

课程计划本身不是 AI 临时生成，而是固定的 12 个阶段、52 个具体 Lesson。

AI 主要负责把同一个知识点变成不同的自然练习，以及根据明确的评分规则检查孩子写的句子。

目前支持本地运行 Qwen，所以孩子的练习可以不依赖云端 AI。

项目地址：
https://github.com/oneminute/writing-trainer

## Launch checklist

Before posting broadly:

- [x] Apache-2.0 license added
- [ ] add repository description
- [ ] add GitHub topics
- [ ] capture Today screenshot
- [ ] capture expanded Plan lesson screenshot
- [ ] capture Progress dashboard screenshot
- [ ] capture Sets / Resume screenshot
- [ ] record 30–60 second GIF/video
- [ ] verify Quick Start on a clean checkout
- [ ] publish a tagged release
- [ ] confirm no API keys, real learner DBs, or private data are present
- [ ] create 2–3 beginner-friendly issues for contributors

## Recommended posting order

1. GitHub README / metadata
2. Local LLM / Ollama community
3. Hacker News
4. developer social post
5. ESL / education feedback communities
6. Chinese technical community
7. parent-facing communities after installation is easier

The first external audience should be developers and local-LLM users, because the current setup is still developer-oriented.
