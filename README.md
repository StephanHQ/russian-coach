# Russian Coach

Stephan's personal Russian trainer: a small offline-capable web app (PWA) plus a tutor workflow with Claude.

**App:** https://stephanhq.github.io/russian-coach/ (open it on your phone, then "Add to Home Screen").

## What's in the app

- **Cards**: spaced repetition with sentence cards. You fill gaps, translate into Russian (typed), or recall meanings. Cards made from your own mistakes come first.
- **Grammar**: grammar sheets with a test for each, plus a placement test (A1–B2).
- **Read & listen**: graded texts. Tap words for meanings, mark unknown words, answer questions. "Listen first" hides the text for a listening test.
- **Practice**: writing prompts (copy your text to Claude for correction), speaking topics for Claude's voice mode, and shadowing with recording.
- **Report for Claude**: one tap copies your results (scores by topic, errors, free answers, unknown words) to paste into a Claude chat.

Your progress stays on your phone (export a backup in Settings). Your assessed level and weak points live in `data/profile.json`, which Claude updates after each session.

## How a session with Claude works

1. Practice in the app.
2. Copy the report and paste it into a chat with Claude, or ask Claude for a lesson, writing task, speaking session or test.
3. Claude grades, assesses honestly (CEFR / ТРКИ), updates `data/profile.json`, adds cards for your mistakes and pushes. The app picks up the new version the next time it opens online.

Rules and data formats for Claude: [CLAUDE.md](CLAUDE.md). After any data change run `python3 tools/build.py`.
