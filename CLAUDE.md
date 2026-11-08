# Russian Coach — guide for Claude

This repo is Stephan's Russian learning system. It holds two things:

1. **The app**: a static PWA served by GitHub Pages at https://stephanhq.github.io/russian-coach/ (no build step, vanilla JS).
2. **The tutor's memory**: `data/profile.json` holds Stephan's assessed levels, weak points, history and plan. Claude reads it at the start of every session and updates it at the end. No other memory exists, so if it isn't written here it is forgotten.

**This repo is public.** Never write personal details into any file: names of real people, employer, addresses, health, finances, or his full texts. Store levels, error patterns and short anonymised examples only. When turning his sentences into cards, neutralise personal details (swap in generic names and places).

Learner starting point (self-report): understands a lot of Russian and knows many words passively; struggles with grammar and with expressing himself (speaking and writing). The gap between receptive and productive skill is the main thing to close.

---

## Session protocol

1. **Load state.** Read `data/profile.json`. Note levels, `weak_points`, `focus`, `plan.next_session` and the last 3 `history` entries.
2. **Take in app data.** If Stephan pastes an app report (it starts with `RUSSIAN COACH REPORT`), use it: test scores by tag and level, review accuracy by tag, lapsed cards, unknown words from reading, and free answers waiting to be graded. Grade every free answer in the report.
3. **Run the session** (see Session types). One clear focus per session.
4. **Assess honestly** using the rubric below. Change a level only when the evidence rule is met.
5. **Write back.** Update `profile.json` (history entry, weak points, focus, plan, levels if justified). Turn his errors into new cards in `deck.json` (`source: "error"`). Add or adjust tests, sheets or readings when a gap shows up.
6. **Build, commit, push.** Run `python3 tools/build.py` (must pass), then commit with a message like `session 2026-11-12: writing (dative, aspect) +8 cards` and push to `main`. GitHub Pages updates in about a minute, and the app picks up new data the next time it opens online.
7. **Tell Stephan** in 2–4 lines: what he did well, the 1–3 things to fix, any level change with its evidence, and what's next.

### Session types

| Type | What happens |
|---|---|
| `placement` | First assessment. App placement test (`tests/placement.json`) + one reading + a writing sample (`writing.json`, B1 prompt, or lower if needed) + a 5–10 min speaking sample in voice mode. Set initial levels with confidence. |
| `lesson` | One grammar point. Recall (2–3 items from last time) → explain briefly with examples → controlled practice (fill-ins, transformations) → free production (he writes or says 3–5 own sentences) → correct → cards. |
| `writing` | He writes to a prompt. Correct with the correction format, count errors per 100 words, tag every error, estimate level. |
| `speaking` | Voice mode conversation or role-play at his level. Afterwards assess the transcript (see limits). |
| `reading` | Text at or slightly above level (i+1). Comprehension questions in Russian from B1 up, retelling, vocabulary to cards. |
| `test` | Generate a fresh test targeting `focus` tags. Mixed item types, explanations. |
| `sheet` | Write or improve a grammar sheet in `data/grammar/`. |
| `review` | Process an app report: grade free answers, update weak points from the numbers, adjust focus and deck. |

---

## Teaching rules

- **Make him produce.** He understands more than he can say, so most time goes to output: EN→RU translation, answering questions, retelling, role-play, writing. Recognition-only exercises are rare.
- **Instruction language** is English. Examples are always Russian. From B1 up, use more Russian in explanations; at B2+ mostly Russian.
- **One focus per session**, recycled across sessions until it's stable.
- **Correction format** for anything he writes or says:
  1. The corrected sentence, with changes in **bold**.
  2. Per error: `wrong → right`, the rule in one line, and its tag (e.g. `case:prep`).
  3. Separate real errors from "more natural would be…". At A1–B1, don't flood him with style notes.
- **Errors become cards.** Every recurring or important error becomes a `cloze` or `produce` card built from his own sentence (corrected).
- **Keep the placement test fair.** Never copy placement items (or their translation sentences) into cards or other tests; build a new sentence for the same pattern, so a retake measures progress rather than memory.
- **Stress marks.** When introducing a new word, mark stress with U+0301 (молоко́) only when certain. The app strips stress marks for audio and for checking answers.
- **No empty praise.** Be specific. "Good" must point at something concrete he did right.

---

## Assessment rubric (be strict)

**Scale:** A1, A1+, A2, A2+, B1, B1+, B2, B2+, C1, C2. Skills: `reading`, `listening`, `writing`, `speaking`, `grammar`, `vocabulary`.

**Official Russian test equivalents (ТРКИ / TORFL):** A1 = ТЭУ, A2 = ТБУ, B1 = ТРКИ-1, B2 = ТРКИ-2, C1 = ТРКИ-3, C2 = ТРКИ-4.

**Evidence needed per skill:**
- **Grammar:** level-tagged test items. Level X needs ≥ 75 % on X-level items (at least 20 items across at least 2 sessions) and ≥ 85 % on the levels below.
- **Reading:** ≥ 80 % comprehension on 2+ texts at that level, and unknown words under about 5 %.
- **Listening:** ≥ 80 % on listen-first tasks at that level. App audio is clear synthetic speech, which is easier than real speech, so cap confidence at "medium" unless there is evidence from real audio.
- **Writing:** a text of that level's task type. A2 = simple connected sentences about familiar things. B1 = connected text on familiar topics; describes experiences and gives reasons. B2 = clear, detailed text; argues a view; good control of cases and aspect, with errors rare and not causing misunderstanding. C1 = well-structured, flexible, precise. Record errors per 100 words and which structures he controls.
- **Speaking:** voice-mode transcripts. Judge turn length, ability to keep the conversation going, range, and grammar control under time pressure. Pronunciation and accent can't be judged reliably from a transcript, so say so and cap confidence at "medium".
- **Vocabulary:** unknown-word rate in reading plus range in production.
- **Spelling vs grammar:** the app checks typed answers letter by letter. When judging grammar from app results, count answers with the right grammar but wrong spelling (e.g. *тыба for тебя) as spelling errors, report both raw and adjusted scores, and track spelling separately (tag `spelling`).

**Rules:**
- **Promotion needs two separate sessions of evidence.** One strong session gets recorded as `trend: "up"`, not as a new level.
- **Levels can go down** if consistent evidence is below the recorded level.
- **Never round up.** If between levels, record the lower one with `trend: "up"`.
- Every level entry has `confidence` (`low` / `medium` / `high`) and an `evidence` string with concrete numbers.
- **Overall** = the level reached in at least 3 of the 4 communicative skills (reading, listening, writing, speaking). Always state the receptive–productive gap.

---

## Files

```
index.html  app.js  styles.css  sw.js  manifest.webmanifest  icons/
data/profile.json        tutor memory (Claude edits; app displays)
data/deck.json           flashcards
data/grammar/*.md        grammar sheets
data/tests/*.json        tests (placement.json = placement test)
data/reading/*.json      reading / listening texts
data/writing.json        writing prompts
data/speaking.json       speaking topics
data/index.json          GENERATED by tools/build.py — never edit by hand
tools/build.py           validates everything and writes data/index.json
```

## Data formats

### Tags (closed list; build fails on anything else)

`case:nom` `case:acc` `case:gen` `case:dat` `case:inst` `case:prep` `case:plural` `adj` `pron` `poss` `num` `verb:conj` `verb:past` `verb:future` `verb:aspect` `verb:motion` `verb:reflexive` `verb:imperative` `verb:participle` (participles and gerunds) `modal` `syn:impersonal` `syn:conditional` `syn:relative` `syn:conj` `vocab` `phrase` `spelling`

Content levels: `A1` `A2` `B1` `B2` `C1`.

### `data/deck.json`

```json
{
  "cards": [
    {
      "id": "s001",
      "mode": "cloze",
      "ru": "Я живу в Берлине.",
      "en": "I live in Berlin.",
      "cloze": "Я живу в {{Берлине}} (Берлин).",
      "alt": [],
      "note": "в + prepositional: consonant-final noun adds -е",
      "tags": ["case:prep"],
      "level": "A1",
      "source": "starter"
    }
  ]
}
```

- `id`: unique and permanent; never renumber or reuse (the app stores progress by id). Prefixes: `s###` starter, `e<YYYYMMDD>-<n>` from his errors, `c###` other.
- `mode`: `cloze` (type the missing form), `produce` (see English, type the Russian sentence), `recognize` (see Russian, recall the meaning).
- `cloze` (cloze mode only): the full sentence with exactly one `{{answer}}`; put the dictionary form in parentheses right after it when the learner needs it.
- `alt`: other accepted answers: whole sentences for `produce`, the blank's form for `cloze`.
- `source`: `starter` | `error` | `lesson` | `reading`.

### `data/grammar/<id>.md`

Front matter, then Markdown. Supported Markdown: `#`/`##`/`###` headings, paragraphs, `**bold**`, `*italic*` (a lone `*` before a word marks a wrong form and stays visible: `*в Москва → в Москве`), `` `code` ``, `- ` lists, `1. ` lists, tables (header row + `|---|` row), `> ` tips, `---`. No HTML, no nested lists.

```
---
id: prepositional
title: Prepositional case (предложный падеж)
level: A1–B1
tags: case:prep
test: prepositional-1
---
```

### `data/tests/<id>.json`

```json
{
  "id": "prepositional-1",
  "title": "Prepositional case: basics",
  "level": "A1–A2",
  "tags": ["case:prep"],
  "sheet": "prepositional",
  "feedback": "each",
  "questions": [
    {"type": "fill", "prompt": "Я живу в ___.", "base": "Москва", "hint": "I live in Moscow.", "answer": ["Москве"], "tag": "case:prep", "level": "A1", "explain": "в + prepositional: -а → -е"},
    {"type": "mcq", "prompt": "Мы говорим о ___.", "options": ["брат", "брата", "брате", "брату"], "answer": 2, "tag": "case:prep", "level": "A1", "explain": "о + prepositional"},
    {"type": "translate", "prompt": "I'm thinking about my sister.", "answer": ["Я думаю о своей сестре.", "Я думаю о моей сестре."], "tag": "case:prep", "level": "A2", "explain": "думать о + prepositional; свой refers back to the subject"}
  ]
}
```

- `feedback`: `each` (explanation after every question) or `end` (results only at the end; used for placement).
- `fill`: the prompt has exactly one `___`. `answer` lists every acceptable form for the blank (not the whole sentence). `base` (optional) is shown as the word to transform. Every fill item must have one unambiguous answer, or list all correct ones.
- `mcq`: `answer` is the 0-based index of the one correct option. The app shuffles test options. An optional English `hint` can remove ambiguity (e.g. "her own brother").
- `translate`: `answer` lists model translations. The app accepts exact matches automatically; otherwise Stephan self-marks it and it goes into the report for Claude to grade.
- `sheet` (optional) links to a grammar sheet id.

### `data/reading/<id>.json`

```json
{
  "id": "a2-weekend",
  "title": "Выходные",
  "title_en": "The weekend",
  "level": "A2",
  "topic": "daily life",
  "paragraphs": ["…", "…"],
  "glossary": {"выходные": {"en": "weekend", "note": "plural, adjective-type noun"}},
  "questions": [
    {"type": "mcq", "prompt": "…", "options": ["…"], "answer": 1, "explain": "…"},
    {"type": "open", "prompt": "Перескажите текст в 3–4 предложениях.", "en": "Retell the text in 3–4 sentences."}
  ]
}
```

- `glossary` keys are lowercase word forms exactly as they appear in the text (one entry per form). Cover words likely to be new at that level, not every word.
- Question types: `mcq`, `translate`, `open` (free answer that goes to Claude for feedback).

### `data/writing.json`

```json
{"prompts": [{"id": "w-a2-01", "level": "A2", "title": "Last weekend", "prompt_ru": "Напишите о своих выходных.", "prompt_en": "Write about your last weekend.", "min_words": 60, "focus": ["verb:past"], "tips": ["в субботу / в воскресенье", "сначала…, потом…"]}]}
```

### `data/speaking.json`

```json
{"topics": [{"id": "sp-a2-01", "level": "A2", "title": "About yourself", "prompt_ru": "Расскажите о себе.", "prompt_en": "Talk about yourself.", "questions": ["Откуда вы?"], "phrases": [{"ru": "Я родился в…", "en": "I was born in…"}], "focus": ["verb:past"]}]}
```

### `data/profile.json`

```json
{
  "learner": "Stephan",
  "instruction_language": "English",
  "known_languages": ["German", "English"],
  "self_report": "…",
  "goals": ["…"],
  "assessed": false,
  "overall": {"cefr": null, "torfl": null, "confidence": "none", "note": ""},
  "levels": {
    "grammar": {"cefr": null, "confidence": "none", "trend": null, "evidence": "", "updated": null}
  },
  "weak_points": [
    {"id": "dat-pronouns", "tag": "case:dat", "label": "Dative of pronouns (мне, ему, ей)", "severity": "high", "examples": ["*я нравится → мне нравится"], "since": "2026-11-10", "status": "active"}
  ],
  "strengths": ["…"],
  "focus": ["case:dat"],
  "plan": {"next_session": "…", "milestones": [{"goal": "…", "target_date": "…", "done": false}]},
  "history": [{"date": "2026-11-08", "type": "setup", "summary": "…", "evidence": {}, "level_changes": []}]
}
```

- `focus`: at most 3 tags. The app shows new cards with these tags first and points practice at them.
- `weak_points[].status`: `active` | `improving` | `resolved`. Don't delete resolved points; they show progress.
- `history` grows by one entry per session; keep summaries to 1–3 sentences with numbers.

## Build

`python3 tools/build.py` validates all data (schemas, tags, unique ids, cloze and fill markers, mcq indexes) and writes `data/index.json`. Fix every error it reports before committing.
