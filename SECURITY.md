# Security and Privacy

## Supported status

Writing Trainer is currently a pre-1.0 personal / local-first project.

Security fixes are accepted for the latest `main` branch.

## Reporting a vulnerability

Please avoid publishing a working exploit or exposing private learner data in a public issue.

For non-sensitive bugs, use a normal GitHub issue.

For sensitive vulnerabilities, use GitHub's private vulnerability reporting feature if it is enabled for the repository. If it is not enabled, contact the repository owner privately through an available GitHub contact channel before disclosing details publicly.

## Secrets

Never commit:

- `.env`
- OpenAI API keys
- other provider credentials
- real learner databases

If a key is accidentally exposed in a screenshot, commit, issue, or log, revoke it and issue a new one.

## Learner data

The default SQLite database is:

```text
data/writing-trainer.db
```

It can contain:

- learner answers
- prompts
- grading feedback
- error history
- practice-session metadata
- mastery records

Treat it as private educational data.

Do not attach a real database to a public issue unless it has been deliberately anonymized.

## LAN mode

`start-writing-trainer-lan.bat` binds the server to the local network.

Use LAN mode only on a trusted private network.

Do not port-forward the Writing Trainer port directly to the public internet.

The application is not currently designed as a hardened multi-user public web service.

## Model providers

With Ollama, prompts can remain on the local machine.

With a cloud model provider, prompts and student answers may be sent to that provider according to its API configuration and policies.

Users are responsible for choosing an appropriate provider for their privacy requirements.

## Dependency security

Keep Node.js and dependencies updated.

Run:

```powershell
npm audit
```

when evaluating dependency vulnerabilities, and verify updates do not break SQLite or model-provider behavior.
