# Security Policy

## Reporting a vulnerability

Please report security problems privately through the contact method on the
repository owner's GitHub profile. Do not publish access codes, API keys,
authentication headers, private screenshots, request logs, or reproducible
credentials in a public issue.

Include the affected workflow, expected behavior, actual behavior, and a
minimal reproduction that contains no secrets or personal data. The project
owner will acknowledge the report and assess its impact before discussing a
public fix.

## Secrets and deployment

- Keep `DEEPSEEK_API_KEY` and `AI_ACCESS_CODE` in server-side environment
  variables only.
- Never place real values in `.env.example`, browser code, screenshots,
  documentation, commits, or Obsidian notes.
- Rotate a credential immediately if it appears in a screenshot, terminal
  output, deployment log, or Git history. Deleting the visible file alone is
  not sufficient.
- Treat the AI access code as lightweight abuse protection, not as a user
  authentication or authorization system.

## Supported version

Security fixes are applied to the latest commit on the `main` branch and the
currently linked public demo. Older commits and local forks are not maintained.

## Data boundaries

The browser stores drafts locally. Screenshots remain local unless the user
explicitly chooses online visual recognition. The Obsidian integration writes
only to its documented pending-review directory after the user grants access.
