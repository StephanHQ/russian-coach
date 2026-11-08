'use strict';
/*
 * Russian Coach: a small vanilla-JS PWA.
 * Course data lives in /data (formats in CLAUDE.md). Progress lives in localStorage under "rc:*".
 */

const S = { index: null, profile: null, deck: null, cache: new Map() };
const main = document.getElementById('main');

/* ======================================================================
   Helpers
   ====================================================================== */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function localDate(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
const today = () => localDate();
function addDays(day, n) {
  const d = new Date(day + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return localDate(d);
}
function fmtDay(day) {
  return new Date(day + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
const stripStress = s => String(s ?? '').replace(/́/g, '');
function norm(s) {
  return stripStress(s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,!?;:«»"“”„()…–—]/g, ' ')
    .replace(/(^|\s)-+|-+(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const words = s => (String(s).match(/[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё́-]*/g) || []).length;
const hasLatin = s => /[a-z]/i.test(s);

/* ---------- storage ---------- */
const LS = {
  get(k, d) {
    try {
      const v = localStorage.getItem('rc:' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('rc:' + k, JSON.stringify(v));
    } catch {
      toast('Could not save. Storage is full or blocked; export a backup in Settings.');
    }
  },
};

const DEFAULTS = { newPerDay: 10, autoplay: true, rate: 0.9, voice: '', hints: true, stress: true };
const settings = () => ({ ...DEFAULTS, ...LS.get('settings', {}) });
function setSetting(k, v) {
  const s = LS.get('settings', {});
  s[k] = v;
  LS.set('settings', s);
}
const ruText = s => esc(settings().stress ? s : stripStress(s));

function markActive() {
  const days = LS.get('days', []);
  const t = today();
  if (days[days.length - 1] !== t) {
    days.push(t);
    LS.set('days', days.slice(-500));
  }
}
function streak() {
  const days = new Set(LS.get('days', []));
  let d = today();
  if (!days.has(d)) d = addDays(d, -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

/* ---------- icons ---------- */
const ICON = {
  speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/></svg>',
};
const sayBtn = (text, label = 'Listen') =>
  `<button class="say" data-act="say" data-text="${esc(stripStress(text))}" aria-label="${esc(label)}">${ICON.speaker}</button>`;

/* ---------- toast & bottom sheet ---------- */
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}
function openSheet(html) {
  const sh = document.getElementById('sheet');
  sh.innerHTML = html;
  sh.hidden = false;
  document.getElementById('sheet-backdrop').hidden = false;
}
function closeSheet() {
  document.getElementById('sheet').hidden = true;
  document.getElementById('sheet-backdrop').hidden = true;
  document.querySelectorAll('.w.sel').forEach(el => el.classList.remove('sel'));
}
document.getElementById('sheet-backdrop').addEventListener('click', closeSheet);

async function copyText(text, okMsg = 'Copied. Paste it into Claude.') {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    toast(ok ? okMsg : 'Copy failed. Select the text and copy it manually.');
    return ok;
  }
}

/* ======================================================================
   Speech (text-to-speech)
   ====================================================================== */
const TTS = {
  ok: 'speechSynthesis' in window,
  voices() {
    return this.ok ? speechSynthesis.getVoices().filter(v => /^ru([-_]|$)/i.test(v.lang)) : [];
  },
  voice() {
    const vs = this.voices();
    const want = settings().voice;
    return vs.find(v => v.voiceURI === want) || vs.find(v => /ru[-_]RU/i.test(v.lang)) || vs[0] || null;
  },
  stop() {
    if (this.ok) speechSynthesis.cancel();
  },
  speak(text, { rate, onend } = {}) {
    if (!this.ok) {
      toast('This browser has no speech output.');
      return;
    }
    speechSynthesis.cancel();
    const parts = splitSentences(stripStress(text));
    const v = this.voice();
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = 'ru-RU';
      if (v) u.voice = v;
      u.rate = rate || settings().rate;
      if (i === parts.length - 1 && onend) u.onend = onend;
      speechSynthesis.speak(u);
    });
  },
};
if (TTS.ok) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.('voiceschanged', () => {});
}
function splitSentences(t) {
  const parts = String(t).match(/[^.!?…]+[.!?…]+["»”]?\s*|[^.!?…]+$/g) || [String(t)];
  return parts.map(s => s.trim()).filter(Boolean);
}

/* ======================================================================
   Data & routing
   ====================================================================== */
async function fetchJSON(path) {
  if (S.cache.has(path)) return S.cache.get(path);
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  const j = await r.json();
  S.cache.set(path, j);
  return j;
}
async function fetchText(path) {
  if (S.cache.has(path)) return S.cache.get(path);
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  const t = await r.text();
  S.cache.set(path, t);
  return t;
}
function prefetchAll() {
  const ix = S.index;
  const paths = [
    ...ix.sheets.map(s => `data/grammar/${s.id}.md`),
    ...ix.tests.map(t => `data/tests/${t.id}.json`),
    ...ix.readings.map(r => `data/reading/${r.id}.json`),
    'data/writing.json',
    'data/speaking.json',
  ];
  paths.forEach((p, i) => setTimeout(() => fetch(p, { cache: 'no-cache' }).catch(() => {}), i * 120));
}

const TAG_LABELS = {
  'case:nom': 'Nominative', 'case:acc': 'Accusative', 'case:gen': 'Genitive', 'case:dat': 'Dative',
  'case:inst': 'Instrumental', 'case:prep': 'Prepositional', 'case:plural': 'Plural cases',
  adj: 'Adjective endings', pron: 'Pronouns', poss: 'Possessives & свой', num: 'Numbers',
  'verb:conj': 'Conjugation', 'verb:past': 'Past tense', 'verb:future': 'Future tense', 'verb:aspect': 'Aspect',
  'verb:motion': 'Verbs of motion', 'verb:reflexive': '-ся verbs', 'verb:imperative': 'Imperative',
  modal: 'Modals (надо, можно…)', 'syn:impersonal': 'Impersonal (мне нравится…)', 'syn:conditional': 'Conditional (бы)',
  'syn:relative': 'который clauses', 'syn:conj': 'Conjunctions', vocab: 'Vocabulary', phrase: 'Phrases',
};
const tagLabel = t => TAG_LABELS[t] || t;
function sheetForTag(tag) {
  const cands = (S.index?.sheets || []).filter(s => s.tags.includes(tag));
  cands.sort((a, b) => a.tags.length - b.tags.length);
  return cands[0] || null;
}
const tagChip = (tag, cls = '') => {
  const sh = sheetForTag(tag);
  return sh
    ? `<a class="chip ${cls}" href="#sheet/${esc(sh.id)}">${esc(tagLabel(tag))}</a>`
    : `<span class="chip ${cls}">${esc(tagLabel(tag))}</span>`;
};
const CEFR = ['A1', 'A1+', 'A2', 'A2+', 'B1', 'B1+', 'B2', 'B2+', 'C1', 'C2'];
const cefrPos = l => {
  const i = CEFR.indexOf(l);
  return i < 0 ? 0 : (i + 1) / CEFR.length;
};

const ROUTES = {
  home: viewHome, cards: viewCards, grammar: viewGrammar, sheet: viewSheet, test: viewTest,
  read: viewReadList, reading: viewReading, practice: viewPractice, write: viewWrite, speak: viewSpeak,
  shadow: viewShadow, report: viewReport, settings: viewSettings,
};
const TAB_OF = {
  home: 'home', cards: 'cards', grammar: 'grammar', sheet: 'grammar', test: 'grammar', read: 'read', reading: 'read',
  practice: 'practice', write: 'practice', speak: 'practice', shadow: 'practice', report: 'home', settings: 'practice',
};

async function render() {
  TTS.stop();
  closeSheet();
  stopRecording();
  const [name = 'home', ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const route = ROUTES[name] ? name : 'home';
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === TAB_OF[route]));
  try {
    await ROUTES[route](decodeURIComponent(rest.join('/')));
  } catch (e) {
    console.error(e);
    main.innerHTML = `<section class="card error"><b>Something went wrong.</b><p class="small">${esc(e.message)}</p><a class="btn" href="#home">Home</a></section>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);

/* ---------- delegated actions ---------- */
const ACT = {};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !ACT[el.dataset.act]) return;
  e.preventDefault();
  ACT[el.dataset.act](el, e);
});
ACT.say = el => TTS.speak(el.dataset.text);
ACT['close-sheet'] = closeSheet;

/* ======================================================================
   Markdown (small subset, see CLAUDE.md)
   ====================================================================== */
function inlineMd(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // *italic* needs a proper closing *; a lone leading * marks a wrong form (*в Москва) and stays visible.
  t = t.replace(/(^|[\s(«—–])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s).,;:!?»—–])/g, '$1<em>$2</em>');
  return t;
}
function renderMd(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  let html = '';
  let para = [];
  let i = 0;
  const flush = () => {
    if (para.length) html += `<p>${inlineMd(para.join(' '))}</p>`;
    para = [];
  };
  const cells = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (/^\s*$/.test(line)) {
      flush();
      i++;
    } else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flush();
      const n = m[1].length;
      html += `<h${n}>${inlineMd(m[2])}</h${n}>`;
      i++;
    } else if (/^\s*-{3,}\s*$/.test(line)) {
      flush();
      html += '<hr>';
      i++;
    } else if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      html += `<div class="table-wrap"><table><thead><tr>${head.map(h => `<th>${inlineMd(h)}</th>`).join('')}</tr></thead><tbody>${body
        .map(r => `<tr>${r.map(c => `<td>${inlineMd(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></div>`;
    } else if (/^\s*>/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      html += `<blockquote>${renderMd(q.join('\n'))}</blockquote>`;
    } else if (/^\s*[-*]\s+/.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ''));
      html += `<ul>${items.map(t => `<li>${inlineMd(t)}</li>`).join('')}</ul>`;
    } else if (/^\s*\d+[.)]\s+/.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
      html += `<ol>${items.map(t => `<li>${inlineMd(t)}</li>`).join('')}</ol>`;
    } else {
      para.push(line.trim());
      i++;
    }
  }
  flush();
  return html;
}

/* ======================================================================
   Home
   ====================================================================== */
const TREND = { up: ' ↑', down: ' ↓', stable: '' };

function viewHome() {
  const p = S.profile;
  const q = buildQueue();
  const assessed = p.assessed && p.overall && p.overall.cefr;
  const placement = LS.get('tests', []).filter(r => r.id === 'placement').pop();
  const placementSent = placement && LS.get('lastReport', 0) > placement.ts;
  const skills = ['reading', 'listening', 'writing', 'speaking', 'grammar', 'vocabulary'];
  const rows = skills
    .map(k => {
      const l = (p.levels || {})[k] || {};
      const w = l.cefr ? Math.round(cefrPos(l.cefr) * 100) : 0;
      return `<div class="lvl-row"><span class="lvl-name">${cap(k)}</span><span class="lvl-bar ${l.confidence === 'low' ? 'low' : ''}"><i style="width:${w}%"></i></span><span class="lvl-val">${l.cefr ? esc(l.cefr) + (TREND[l.trend] || '') : '—'}</span></div>`;
    })
    .join('');
  const levelCard = assessed
    ? `<div class="eyebrow">Your level</div>
       <div class="row between"><div class="big">${esc(p.overall.cefr)}</div>
       <div class="right small muted" style="text-align:right">${esc(p.overall.torfl || '')}<br>confidence: ${esc(p.overall.confidence || '—')}</div></div>
       <div class="levels">${rows}</div>
       ${p.overall.note ? `<p class="small muted">${esc(p.overall.note)}</p>` : ''}`
    : `<div class="eyebrow">Your level</div><div class="big">Not assessed yet</div>
       <p class="small">Claude sets your level from evidence: the placement test here, then a writing and a speaking sample in chat. No guessing.</p>
       ${placementSent
         ? `<div class="fb mid"><b class="head">Placement results sent</b><div class="small">Next: ask Claude for the writing and speaking sample. Your level appears here once Claude has assessed it.</div></div>`
         : placement
           ? `<a class="btn primary block" href="#report">Send placement results to Claude</a>`
           : `<a class="btn primary block" href="#test/placement">Take the placement test</a>`}`;

  const dueN = q.due.length;
  const newN = q.fresh.length;
  main.innerHTML = `
    <section class="card">${levelCard}</section>
    <section class="card">
      <div class="row between">
        <div><div class="eyebrow">Today</div><div class="stat">${dueN} due · ${newN} new</div></div>
        <div class="streak" title="Days in a row">🔥 ${streak()}</div>
      </div>
      <a class="btn ${dueN + newN ? 'primary' : ''} block" href="#cards">${dueN + newN ? 'Start cards' : 'All cards done for today'}</a>
    </section>
    ${focusCard(p)}
    ${p.plan && p.plan.next_session ? `<section class="card"><div class="eyebrow">Next step</div><p style="margin:4px 0 0">${esc(p.plan.next_session)}</p></section>` : ''}
    <section class="card">
      <div class="eyebrow">Report for Claude</div>
      <p class="small muted" style="margin:4px 0 10px">${esc(reportBlurb())}</p>
      <div class="row gap"><button class="btn primary" data-act="copy-report">Copy report</button><a class="btn" href="#report">View &amp; stats</a></div>
    </section>
    <p class="foot muted tiny">Content ${esc(S.index.version)} · updated ${esc(S.index.built.slice(0, 10))}</p>`;
}

function focusCard(p) {
  const focus = p.focus || [];
  const weak = (p.weak_points || []).filter(w => w.status !== 'resolved');
  if (!focus.length && !weak.length) return '';
  const sev = { high: 'bad', medium: 'warn', low: '' };
  return `<section class="card">
    <div class="eyebrow">Current focus</div>
    <div style="margin-top:6px">${focus.map(t => tagChip(t)).join('')}</div>
    ${weak
      .slice(0, 4)
      .map(
        w => `<div class="weak"><div class="row between"><b>${esc(w.label)}</b><span class="badge ${sev[w.severity] || ''}">${esc(w.status === 'improving' ? 'improving' : w.severity || '')}</span></div>
        ${(w.examples || []).length ? `<div class="ex">${esc(w.examples.slice(0, 2).join(' · '))}</div>` : ''}</div>`
      )
      .join('')}
  </section>`;
}

/* ======================================================================
   Cards: spaced repetition (SM-2 style)
   ====================================================================== */
const cardById = id => (S.deck.cards || []).find(c => c.id === id);

function schedule(prev, g) {
  // g: 0 again, 1 hard, 2 good, 3 easy
  const s = prev ? { ...prev } : { ease: 2.5, interval: 0, reps: 0, lapses: 0 };
  if (g === 0) {
    if (s.interval > 0) s.lapses++;
    s.interval = 0;
    s.ease = Math.max(1.3, s.ease - 0.2);
  } else if (s.interval === 0) {
    s.interval = g === 3 ? 3 : 1;
    if (g === 1) s.ease = Math.max(1.3, s.ease - 0.15);
    if (g === 3) s.ease += 0.1;
  } else if (g === 1) {
    s.interval = Math.max(s.interval + 1, Math.round(s.interval * 1.2));
    s.ease = Math.max(1.3, s.ease - 0.15);
  } else if (g === 2) {
    s.interval = Math.max(s.interval + 1, Math.round(s.interval * s.ease));
  } else {
    s.interval = Math.max(s.interval + 2, Math.round(s.interval * s.ease * 1.3));
    s.ease += 0.15;
  }
  if (s.interval > 4 && !prev?.__noFuzz) s.interval = Math.round(s.interval * (0.95 + Math.random() * 0.1));
  s.due = addDays(today(), s.interval);
  if (g > 0) s.reps++;
  s.last = today();
  return s;
}
function intervalLabel(prev, g) {
  const s = schedule(prev ? { ...prev, __noFuzz: true } : { ease: 2.5, interval: 0, reps: 0, lapses: 0, __noFuzz: true }, g);
  if (s.interval === 0) return 'again';
  if (s.interval < 30) return `${s.interval}d`;
  if (s.interval < 365) return `${Math.round(s.interval / 30)}mo`;
  return `${(s.interval / 365).toFixed(1)}y`;
}

function buildQueue() {
  const srs = LS.get('srs', {});
  const t = today();
  const cards = S.deck.cards || [];
  const due = cards
    .filter(c => srs[c.id] && srs[c.id].due <= t)
    .sort((a, b) => srs[a.id].due.localeCompare(srs[b.id].due) || srs[a.id].interval - srs[b.id].interval);
  const nt = LS.get('newToday', {});
  const introduced = nt.date === t ? nt.n || 0 : 0;
  const extra = nt.date === t ? nt.extra || 0 : 0;
  const left = Math.max(0, settings().newPerDay + extra - introduced);
  const focus = new Set(S.profile.focus || []);
  const score = c => (c.source === 'error' ? 2 : 0) + (c.tags.some(x => focus.has(x)) ? 1 : 0);
  const unseen = cards.filter(c => !srs[c.id]);
  const ranked = unseen.map((c, i) => ({ c, i, s: score(c) })).sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.c);
  return { due, fresh: ranked.slice(0, left), unseenTotal: unseen.length };
}

let CS = null; // current card session

function viewCards() {
  const q = buildQueue();
  if (!q.due.length && !q.fresh.length) {
    main.innerHTML = `<section class="card center">
      <div class="big" style="margin:10px 0">Готово!</div>
      <p>Nothing due right now. Come back tomorrow, the cards are scheduled.</p>
      ${q.unseenTotal ? `<button class="btn primary" data-act="more-new">Learn 5 more new cards</button>` : '<p class="muted small">You have started every card in the deck. Claude adds new ones after your sessions.</p>'}
      <p class="small muted" style="margin-top:14px">${plural(q.unseenTotal, 'new card', 'new cards')} left in the deck.</p></section>`;
    return;
  }
  // Mix new cards in between due ones (one new after every 3 due).
  const order = [];
  let ni = 0;
  q.due.forEach((c, i) => {
    order.push(c.id);
    if ((i + 1) % 3 === 0 && ni < q.fresh.length) order.push(q.fresh[ni++].id);
  });
  while (ni < q.fresh.length) order.push(q.fresh[ni++].id);
  CS = { queue: order, i: 0, phase: 'ask', given: '', correct: null, seen: 0, ok: 0, errTags: {}, fails: {} };
  renderCard();
}

function splitCloze(cz) {
  const m = String(cz).match(/^([\s\S]*?)\{\{([^{}]+)\}\}([\s\S]*)$/);
  return m ? [m[1], m[2], m[3]] : [String(cz), '', ''];
}

function renderCard() {
  const id = CS.queue[CS.i];
  const c = id && cardById(id);
  if (!c) return renderCardsDone();
  const set = settings();
  const srs = LS.get('srs', {});
  const isNew = !srs[c.id];
  const head = `<div class="row between small muted"><span>${CS.i + 1} / ${CS.queue.length}${isNew ? ' · <b style="color:var(--accent)">new</b>' : ''}</span><span><span class="lvl">${esc(c.level)}</span> ${c.tags.map(t => esc(tagLabel(t))).join(', ')}</span></div>
    <div class="progress"><i style="width:${pct(CS.i, CS.queue.length)}%"></i></div>`;
  let body = '';
  let controls = '';
  const show = CS.phase === 'show';

  if (c.mode === 'cloze') {
    const [before, ans, after] = splitCloze(c.cloze || c.ru);
    body = `<div class="eyebrow">Fill the gap</div>
      <div class="big-ru">${ruText(before)}<span class="blank">${show ? ruText(ans) : '?'}</span>${ruText(after)}</div>
      ${set.hints ? `<div class="en">${esc(c.en)}</div>` : ''}`;
    if (!show) controls = `<input id="ans" class="answer" lang="ru" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="Type the missing form">`;
  } else if (c.mode === 'produce') {
    body = `<div class="eyebrow">Say it in Russian</div><div class="big-en">${esc(c.en)}</div>`;
    if (!show) controls = `<textarea id="ans" class="answer" lang="ru" rows="2" autocomplete="off" autocorrect="off" autocapitalize="sentences" spellcheck="false" enterkeyhint="done" placeholder="Type it in Russian"></textarea>`;
  } else {
    body = `<div class="eyebrow">What does it mean?</div><div class="big-ru row" style="gap:10px">${ruText(c.ru)} ${sayBtn(c.ru)}</div>`;
  }

  if (!show) {
    controls +=
      c.mode === 'recognize'
        ? `<button class="btn primary block" data-act="card-reveal">Show meaning</button>`
        : `<div class="row gap" style="margin-top:4px"><button class="btn primary" data-act="card-check">Check</button><button class="btn ghost" data-act="card-dunno">I don't know</button></div>`;
  } else {
    controls = cardFeedback(c) + gradeButtons(srs[c.id]);
  }
  main.innerHTML = `<section class="card">${head}${body}${controls}</section>
    <p class="center"><a class="small muted" href="#home">End session</a></p>`;

  const inp = document.getElementById('ans');
  if (inp) {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        ACT['card-check']();
      }
    });
    inp.addEventListener('input', () => {
      const warn = document.getElementById('kbd');
      if (hasLatin(inp.value) && !warn) inp.insertAdjacentHTML('afterend', '<div id="kbd" class="kbd-hint">Latin letters detected: switch to a Russian keyboard.</div>');
      if (!hasLatin(inp.value) && warn) warn.remove();
    });
    setTimeout(() => inp.focus(), 30);
  }
  if (show && set.autoplay) TTS.speak(c.ru);
  if (c.mode === 'recognize' && !show && set.autoplay) TTS.speak(c.ru);
}

function cardFeedback(c) {
  const given = CS.given;
  if (c.mode === 'recognize') {
    return `<div class="fb mid"><div class="big-en" style="margin:0">${esc(c.en)}</div>${c.note ? `<div class="note">${esc(c.note)}</div>` : ''}</div>`;
  }
  const model = `<div class="model">${ruText(c.ru)} ${sayBtn(c.ru)}</div>`;
  const note = c.note ? `<div class="note">${esc(c.note)}</div>` : '';
  if (c.mode === 'cloze') {
    const ans = splitCloze(c.cloze)[1];
    if (CS.correct) return `<div class="fb ok"><b class="head">✓ Correct</b>${model}${note}</div>`;
    return `<div class="fb bad"><b class="head">${given ? '✗ Not quite' : 'Answer'}</b>
      ${given ? `<div class="small">You wrote: <span class="ru">${esc(given)}</span> · correct: <b class="ru">${ruText(ans)}</b>${(c.alt || []).length ? ` (also: ${c.alt.map(esc).join(', ')})` : ''}</div>` : ''}
      ${model}${note}</div>`;
  }
  // produce
  if (CS.correct) return `<div class="fb ok"><b class="head">✓ Exactly right</b>${model}${note}</div>`;
  if (!given) return `<div class="fb bad"><b class="head">Answer</b>${model}${altList(c)}${note}</div>`;
  const best = [c.ru, ...(c.alt || [])].map(t => ({ t, d: wordDiff(given, t) })).sort((a, b) => b.d.score - a.d.score)[0];
  return `<div class="fb mid"><b class="head">Compare and grade yourself honestly</b>
    <div class="diff"><span class="muted small">You: </span>${best.d.a.map(w => (w.ok ? esc(w.w) : `<span class="x">${esc(w.w)}</span>`)).join(' ')}</div>
    <div class="diff"><span class="muted small">Model: </span>${best.d.b.map(w => (w.ok ? esc(w.w) : `<span class="m">${esc(w.w)}</span>`)).join(' ')}</div>
    <hr style="margin:10px 0">${model}${altList(c)}${note}</div>`;
}
const altList = c => ((c.alt || []).length ? `<div class="small muted">Also correct: <span class="ru">${c.alt.map(ruText).join(' · ')}</span></div>` : '');

function gradeButtons(prev) {
  const sug = CS.correct === true ? 2 : CS.correct === false ? 0 : -1;
  const names = ['Again', 'Hard', 'Good', 'Easy'];
  const cls = ['again', '', 'good', ''];
  return `<div class="grades">${names
    .map((n, g) => `<button class="grade ${cls[g]} ${g === sug ? 'suggest' : ''}" data-act="grade" data-g="${g}">${n}<small>${intervalLabel(prev, g)}</small></button>`)
    .join('')}</div>`;
}

function wordDiff(given, target) {
  const a = norm(given).split(' ').filter(Boolean);
  const b = norm(target).split(' ').filter(Boolean);
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const inA = new Set();
  const inB = new Set();
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      inA.add(i++);
      inB.add(j++);
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return {
    a: a.map((w, k) => ({ w, ok: inA.has(k) })),
    b: b.map((w, k) => ({ w, ok: inB.has(k) })),
    score: Math.max(m, n) ? dp[0][0] / Math.max(m, n) : 0,
  };
}

ACT['card-check'] = () => {
  if (!CS || CS.phase !== 'ask') return;
  const c = cardById(CS.queue[CS.i]);
  const inp = document.getElementById('ans');
  const given = inp ? inp.value.trim() : '';
  if (!given) return ACT['card-dunno']();
  CS.given = given;
  if (c.mode === 'cloze') {
    const ans = [splitCloze(c.cloze)[1], ...(c.alt || [])];
    CS.correct = ans.some(a => norm(a) === norm(given));
  } else {
    CS.correct = [c.ru, ...(c.alt || [])].some(a => norm(a) === norm(given)) ? true : null;
  }
  CS.phase = 'show';
  renderCard();
};
ACT['card-dunno'] = () => {
  CS.given = '';
  CS.correct = false;
  CS.phase = 'show';
  renderCard();
};
ACT['card-reveal'] = () => {
  CS.given = '';
  CS.correct = null;
  CS.phase = 'show';
  renderCard();
};
ACT.grade = el => {
  const g = Number(el.dataset.g);
  const c = cardById(CS.queue[CS.i]);
  const srs = LS.get('srs', {});
  const wasNew = !srs[c.id];
  srs[c.id] = schedule(srs[c.id], g);
  LS.set('srs', srs);
  if (wasNew) {
    const t = today();
    const nt = LS.get('newToday', {});
    LS.set('newToday', nt.date === t ? { ...nt, n: (nt.n || 0) + 1 } : { date: t, n: 1, extra: 0 });
  }
  const ok = CS.correct !== null ? CS.correct : g >= 2;
  const log = LS.get('log', []);
  log.push({ t: Date.now(), id: c.id, g, ok, mode: c.mode, tags: c.tags, given: CS.given && !ok ? CS.given.slice(0, 120) : undefined });
  LS.set('log', log.slice(-4000));
  markActive();
  CS.seen++;
  if (ok && g > 0) CS.ok++;
  else c.tags.forEach(t => (CS.errTags[t] = (CS.errTags[t] || 0) + 1));
  if (g === 0) {
    CS.fails[c.id] = (CS.fails[c.id] || 0) + 1;
    if (CS.fails[c.id] < 3) CS.queue.splice(Math.min(CS.queue.length, CS.i + 4), 0, c.id);
  }
  CS.i++;
  CS.phase = 'ask';
  CS.given = '';
  CS.correct = null;
  renderCard();
};
ACT['more-new'] = () => {
  const t = today();
  const nt = LS.get('newToday', {});
  const cur = nt.date === t ? nt : { date: t, n: 0, extra: 0 };
  cur.extra = (cur.extra || 0) + 5;
  LS.set('newToday', cur);
  if (location.hash === '#cards') viewCards();
  else location.hash = '#cards';
};
document.addEventListener('keydown', e => {
  if (!CS || CS.phase !== 'show' || location.hash !== '#cards') return;
  if (['1', '2', '3', '4'].includes(e.key) && !/input|textarea/i.test(document.activeElement?.tagName || '')) {
    const btn = document.querySelector(`.grade[data-g="${Number(e.key) - 1}"]`);
    if (btn) btn.click();
  }
});

function renderCardsDone() {
  const tags = Object.entries(CS.errTags).sort((a, b) => b[1] - a[1]);
  const left = buildQueue();
  main.innerHTML = `<section class="card center">
    <div class="big" style="margin:8px 0">Готово!</div>
    <p>${plural(CS.seen, 'review', 'reviews')} · ${pct(CS.ok, CS.seen)}% right</p>
    ${tags.length ? `<div class="eyebrow" style="margin-top:12px">Slipped on</div><div>${tags.map(([t]) => tagChip(t, 'bad')).join('')}</div>` : ''}
    <div class="row gap" style="justify-content:center;margin-top:14px">
      <a class="btn primary" href="#home">Home</a>
      ${left.due.length + left.fresh.length ? `<button class="btn" data-act="cards-again">Continue (${left.due.length + left.fresh.length})</button>` : left.unseenTotal ? `<button class="btn" data-act="more-new">5 more new</button>` : ''}
    </div></section>`;
  CS = null;
}
ACT['cards-again'] = () => viewCards();

/* ======================================================================
   Grammar: sheets & tests
   ====================================================================== */
function lastResult(testId) {
  const r = LS.get('tests', []).filter(x => x.id === testId);
  return r[r.length - 1] || null;
}
function scoreBadge(r) {
  if (!r) return '';
  const p = pct(r.correct, r.total);
  return `<span class="badge ${p >= 80 ? 'ok' : p >= 60 ? 'warn' : 'bad'}">${p}%</span>`;
}

function viewGrammar() {
  const ix = S.index;
  const place = ix.tests.find(t => t.id === 'placement');
  const pr = place && lastResult('placement');
  const loose = ix.tests.filter(t => t.id !== 'placement' && !t.sheet);
  const focus = new Set(S.profile.focus || []);
  main.innerHTML = `
    <h1 class="page">Grammar</h1>
    ${place ? `<a class="list-item" href="#test/placement" style="border-color:var(--accent)">
      <div><div class="title">Placement test</div><div class="sub">${place.count} questions · A1 → B2 · ${pr ? `last: ${fmtDay(pr.date)}` : 'about 25 minutes'}</div></div>
      <div class="right">${scoreBadge(pr) || '<span class="chip">Start</span>'}</div></a>` : ''}
    <h2 class="section">Sheets &amp; tests</h2>
    <ul class="list">${ix.sheets
      .map(s => {
        const r = s.tests[0] && lastResult(s.tests[0]);
        const hot = s.tags.some(t => focus.has(t));
        return `<li><a class="list-item" href="#sheet/${esc(s.id)}">
          <div><div class="title">${esc(s.title)}${hot ? ' <span class="chip warn" style="margin:0 0 0 4px">focus</span>' : ''}</div><div class="sub">${esc(s.level)}${s.tests.length ? ` · test${r ? ` ${fmtDay(r.date)}` : ' not taken'}` : ''}</div></div>
          <div class="right">${scoreBadge(r)}</div></a></li>`;
      })
      .join('')}</ul>
    ${loose.length ? `<h2 class="section">More tests</h2><ul class="list">${loose
      .map(t => `<li><a class="list-item" href="#test/${esc(t.id)}"><div><div class="title">${esc(t.title)}</div><div class="sub">${esc(t.level)} · ${t.count} questions</div></div><div class="right">${scoreBadge(lastResult(t.id))}</div></a></li>`)
      .join('')}</ul>` : ''}`;
}

async function viewSheet(id) {
  const meta = S.index.sheets.find(s => s.id === id);
  if (!meta) throw new Error(`Unknown sheet "${id}"`);
  const src = await fetchText(`data/grammar/${id}.md`);
  const body = src.replace(/^---\n[\s\S]*?\n---\n/, '');
  const tests = meta.tests.map(tid => S.index.tests.find(t => t.id === tid)).filter(Boolean);
  main.innerHTML = `
    <p class="small" style="margin:4px 2px 10px"><a href="#grammar">← Grammar</a></p>
    <article class="card md">${renderMd(body)}</article>
    ${tests
      .map(t => {
        const r = lastResult(t.id);
        return `<a class="btn primary block" href="#test/${esc(t.id)}">Test: ${esc(t.title)} (${t.count})${r ? ` · last ${pct(r.correct, r.total)}%` : ''}</a>`;
      })
      .join('')}`;
}

/* ---------- test engine ---------- */
let TS = null;

async function viewTest(id) {
  const t = await fetchJSON(`data/tests/${id}.json`);
  TS = { t, i: -1, answers: [], phase: 'q', order: t.questions.map(q => (q.type === 'mcq' ? shuffle(q.options.map((_, k) => k)) : null)) };
  const prev = LS.get('tests', []).filter(x => x.id === id);
  const placement = id === 'placement';
  main.innerHTML = `
    <p class="small" style="margin:4px 2px 10px"><a href="#grammar">← Grammar</a></p>
    <section class="card">
      <div class="eyebrow">${placement ? 'Placement' : 'Test'} · ${esc(t.level)}</div>
      <h2>${esc(t.title)}</h2>
      <p>${t.questions.length} questions. ${t.feedback === 'end' ? 'You see the results and explanations at the end.' : 'You get an explanation after each question.'}</p>
      ${placement ? `<p class="small">Questions go from A1 up to B2 and get harder. When you don't know, tap <b>I don't know</b> instead of guessing: it makes the result honest. The translation items go to Claude for grading.</p>` : ''}
      <p class="small muted">You need a Russian keyboard on your phone for the typing questions.</p>
      ${prev.length ? `<p class="small muted">Previous: ${prev.slice(-3).map(r => `${fmtDay(r.date)} ${pct(r.correct, r.total)}%`).join(' · ')}</p>` : ''}
      <button class="btn primary block" data-act="test-start">Start</button>
    </section>
    ${t.sheet ? `<a class="btn block" href="#sheet/${esc(t.sheet)}">Read the sheet first</a>` : ''}`;
}
ACT['test-start'] = () => {
  TS.i = 0;
  renderQ();
};

const fillPrompt = p => ruText(p).replace('___', '<span class="blank">&nbsp;&nbsp;&nbsp;</span>');

function renderQ() {
  const { t, i } = TS;
  const q = t.questions[i];
  if (!q) return finishTest();
  TS.phase = 'q';
  const head = `<div class="row between small muted"><span>${esc(t.title)}</span><span>${i + 1} / ${t.questions.length}</span></div>
    <div class="progress"><i style="width:${pct(i, t.questions.length)}%"></i></div>`;
  let body;
  if (q.type === 'fill') {
    body = `<div class="eyebrow">Fill the gap</div><div class="big-ru">${fillPrompt(q.prompt)}</div>
      ${q.base ? `<div class="base">(${ruText(q.base)})</div>` : ''}${q.hint ? `<div class="en small">${esc(q.hint)}</div>` : ''}
      <input id="ans" class="answer" lang="ru" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="Missing form">`;
  } else if (q.type === 'mcq') {
    body = `<div class="eyebrow">Choose</div><div class="big-ru">${fillPrompt(q.prompt)}</div>
      ${q.hint ? `<div class="en small">${esc(q.hint)}</div>` : ''}
      <div class="options">${TS.order[i].map(k => `<button class="opt" data-act="mcq" data-k="${k}">${ruText(q.options[k])}</button>`).join('')}</div>`;
  } else {
    body = `<div class="eyebrow">Translate into Russian</div><div class="big-en">${esc(q.prompt)}</div>
      <textarea id="ans" class="answer" lang="ru" rows="3" autocomplete="off" autocorrect="off" autocapitalize="sentences" spellcheck="false" placeholder="По-русски…"></textarea>`;
  }
  const btns =
    q.type === 'mcq'
      ? `<button class="btn ghost block" data-act="q-skip">I don't know</button>`
      : `<div class="row gap"><button class="btn primary" data-act="q-check">${t.feedback === 'end' ? 'Next' : 'Check'}</button><button class="btn ghost" data-act="q-skip">I don't know</button></div>`;
  main.innerHTML = `<section class="card">${head}${body}<div id="fb"></div><div id="qbtns">${btns}</div></section>
    <p class="center"><a class="small muted" href="#grammar">Quit test</a></p>`;
  const inp = document.getElementById('ans');
  if (inp) {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        ACT['q-check']();
      }
    });
    setTimeout(() => inp.focus(), 30);
  }
}

function completeSentence(q) {
  if (q.type === 'fill') return q.prompt.replace('___', q.answer[0]);
  if (q.type === 'mcq' && q.prompt.includes('___')) return q.prompt.replace('___', q.options[q.answer]);
  if (q.type === 'translate') return q.answer[0];
  return '';
}

function answerQ(given, k) {
  if (TS.phase !== 'q') return;
  const q = TS.t.questions[TS.i];
  let ok;
  if (q.type === 'mcq') ok = k === q.answer;
  else if (!given) ok = false;
  else if (q.type === 'fill') ok = q.answer.some(a => norm(a) === norm(given));
  else ok = q.answer.some(a => norm(a) === norm(given)) ? true : null;
  const rec = {
    q: TS.i, type: q.type, tag: q.tag, level: q.level, ok,
    given: q.type === 'mcq' ? (k == null ? '' : q.options[k]) : given,
    prompt: q.prompt.slice(0, 160), expected: q.type === 'mcq' ? q.options[q.answer] : q.answer[0],
  };
  TS.answers[TS.i] = rec;
  if (TS.t.feedback === 'end') {
    TS.i++;
    renderQ();
    return;
  }
  TS.phase = 'fb';
  if (q.type === 'mcq') {
    document.querySelectorAll('.opt').forEach(b => {
      const kk = Number(b.dataset.k);
      b.disabled = true;
      if (kk === q.answer) b.classList.add('right');
      else if (kk === k) b.classList.add('wrong');
    });
  }
  const inp = document.getElementById('ans');
  if (inp) inp.readOnly = true;
  const full = completeSentence(q);
  let fb;
  if (ok === true) fb = `<div class="fb ok"><b class="head">✓ Correct</b>`;
  else if (ok === false) fb = `<div class="fb bad"><b class="head">${given || k != null ? '✗ Not quite' : 'Answer'}</b>${q.type !== 'mcq' ? `<div>Correct: <b class="ru">${q.answer.map(ruText).join(' / ')}</b></div>` : ''}`;
  else fb = `<div class="fb mid"><b class="head">Compare with the model</b><div class="small">Model answers:</div><div class="ru">${q.answer.map(ruText).join('<br>')}</div>`;
  fb += `${full ? `<div class="model small">${ruText(full)} ${sayBtn(full)}</div>` : ''}${q.explain ? `<div class="note">${esc(q.explain)}</div>` : ''}</div>`;
  document.getElementById('fb').innerHTML = fb;
  document.getElementById('qbtns').innerHTML =
    ok === null
      ? `<div class="small" style="margin-bottom:6px">Was yours correct (same meaning, no grammar mistakes)?</div><div class="row gap"><button class="btn" data-act="self" data-v="1">Yes, correct</button><button class="btn" data-act="self" data-v="0">No</button></div>`
      : `<button class="btn primary block" data-act="q-next">Next</button>`;
}
ACT['q-check'] = () => {
  if (!TS || TS.phase !== 'q') return;
  const inp = document.getElementById('ans');
  answerQ(inp ? inp.value.trim() : '', null);
};
ACT['q-skip'] = () => answerQ('', null);
ACT.mcq = el => answerQ('', Number(el.dataset.k));
ACT.self = el => {
  TS.answers[TS.i].self = el.dataset.v === '1';
  ACT['q-next']();
};
ACT['q-next'] = () => {
  TS.i++;
  renderQ();
};

const verdict = r => (r.ok === true || r.ok === false ? r.ok : typeof r.self === 'boolean' ? r.self : null);
function summarize(items) {
  const byLevel = {};
  const byTag = {};
  let n = 0;
  let ok = 0;
  let pending = 0;
  for (const r of items) {
    const v = verdict(r);
    if (v === null || (r.type === 'translate' && r.ok === null && TS?.t?.feedback === 'end')) {
      pending++;
      continue;
    }
    n++;
    if (v) ok++;
    for (const [map, key] of [[byLevel, r.level], [byTag, r.tag]]) {
      if (!key) continue;
      map[key] = map[key] || { n: 0, ok: 0 };
      map[key].n++;
      if (v) map[key].ok++;
    }
  }
  return { n, ok, pending, byLevel, byTag };
}
function grammarEstimate(byLevel) {
  const order = ['A1', 'A2', 'B1', 'B2'];
  let est = null;
  for (let k = 0; k < order.length; k++) {
    const L = byLevel[order[k]];
    if (!L || L.n < 4) break;
    const lowerOk = order.slice(0, k).every(x => byLevel[x] && byLevel[x].ok / byLevel[x].n >= 0.85);
    if (L.ok / L.n >= 0.75 && lowerOk) est = order[k];
    else break;
  }
  if (est) {
    const next = byLevel[order[order.indexOf(est) + 1]];
    if (next && next.n >= 4 && next.ok / next.n >= 0.5) est += '+';
  }
  return est || 'below A1';
}

function finishTest() {
  const { t } = TS;
  const items = t.questions.map((q, i) => TS.answers[i] || { q: i, type: q.type, tag: q.tag, level: q.level, ok: false, given: '', prompt: q.prompt.slice(0, 160), expected: q.type === 'mcq' ? q.options[q.answer] : q.answer[0] });
  const sum = summarize(items);
  const result = {
    id: t.id, title: t.title, date: today(), ts: Date.now(), total: sum.n, correct: sum.ok, pending: sum.pending,
    byLevel: sum.byLevel, byTag: sum.byTag, items,
  };
  if (t.id === 'placement') result.estimate = grammarEstimate(sum.byLevel);
  const all = LS.get('tests', []);
  all.push(result);
  LS.set('tests', all.slice(-200));
  markActive();
  renderResult(result, t);
}

function bar(label, ok, n) {
  const p = pct(ok, n);
  return `<div class="bar-row"><span>${esc(label)}</span><span class="track"><i class="${p >= 80 ? 'ok' : p >= 60 ? 'warn' : 'bad'}" style="width:${p}%"></i></span><span class="num">${ok}/${n} · ${p}%</span></div>`;
}

function renderResult(r, t) {
  const levels = ['A1', 'A2', 'B1', 'B2', 'C1'].filter(l => r.byLevel[l]);
  const tags = Object.entries(r.byTag).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n);
  const review = r.items
    .map((it, i) => {
      const q = t.questions[i];
      const v = verdict(it);
      const mark = v === true ? '<span class="mark ok">✓</span>' : v === false ? '<span class="mark bad">✗</span>' : '<span class="mark q">?</span>';
      const shown = q.type === 'translate' ? `<span class="en">${esc(q.prompt)}</span>` : ruText(q.prompt);
      return `<div class="review-item">${mark}<span class="q">${shown}</span>
        <div class="a">${it.given ? `You: <span class="ru">${esc(it.given)}</span> · ` : '<span class="muted">No answer</span> · '}Correct: <b class="ru">${esc(it.expected)}</b>${q.type === 'translate' && it.ok === null ? ' <span class="badge warn">Claude grades</span>' : ''}</div>
        ${q.explain && v !== true ? `<div class="note">${esc(q.explain)}</div>` : ''}</div>`;
    })
    .join('');
  main.innerHTML = `
    <section class="card">
      <div class="eyebrow">${esc(t.title)} · results</div>
      <div class="row between"><div class="score">${pct(r.correct, r.total)}%</div><div class="muted">${r.correct} / ${r.total}${r.pending ? `<br><span class="small">+${r.pending} for Claude</span>` : ''}</div></div>
      ${r.estimate ? `<div class="fb mid" style="margin-top:12px"><b class="head">Provisional grammar estimate: ${esc(r.estimate)}</b><div class="small">From this test only. Claude confirms your levels with a writing and speaking sample and the translation items.</div></div>` : ''}
      ${levels.length > 1 ? `<div class="eyebrow" style="margin-top:14px">By level</div><div class="bars">${levels.map(l => bar(l, r.byLevel[l].ok, r.byLevel[l].n)).join('')}</div>` : ''}
      ${tags.length > 1 ? `<div class="eyebrow" style="margin-top:14px">By topic (weakest first)</div><div class="bars">${tags.slice(0, 10).map(([tg, s]) => bar(tagLabel(tg), s.ok, s.n)).join('')}</div>` : ''}
      <div class="row gap" style="margin-top:14px">
        <button class="btn primary" data-act="copy-test" data-ts="${r.ts}">Copy results for Claude</button>
        <a class="btn" href="#test/${esc(t.id)}">Retake</a>
      </div>
    </section>
    <section class="card"><div class="eyebrow">Review</div>${review}</section>
    <a class="btn block" href="#grammar">Back to grammar</a>`;
}
ACT['copy-test'] = el => {
  const r = LS.get('tests', []).find(x => String(x.ts) === el.dataset.ts);
  if (r) copyText(`RUSSIAN COACH REPORT (single test)\n\n${testSection(r, true)}\n\nPlease grade the translations, analyse my mistakes, and update my profile.`);
};

/* ======================================================================
   Reading & listening
   ====================================================================== */
function viewReadList() {
  const done = LS.get('reading', []);
  const lastFor = id => done.filter(x => x.id === id).pop();
  const byLevel = {};
  S.index.readings.forEach(r => (byLevel[r.level] = byLevel[r.level] || []).push(r));
  main.innerHTML = `<h1 class="page">Read &amp; listen</h1>
    <p class="small muted" style="margin:-6px 4px 12px">Tap any word for its meaning and mark the ones you didn't know. <b>Listen first</b> hides the text: a listening test.</p>
    ${Object.keys(byLevel)
      .sort()
      .map(
        l => `<h2 class="section">${esc(l)}</h2><ul class="list">${byLevel[l]
          .map(r => {
            const last = lastFor(r.id);
            return `<li><a class="list-item" href="#reading/${esc(r.id)}"><div><div class="title ru">${esc(r.title)}</div><div class="sub">${esc(r.title_en)} · ${r.words} words · ${esc(r.topic)}</div></div>
            <div class="right">${last ? `<span class="badge ${pct(last.mcq.ok, last.mcq.n) >= 80 ? 'ok' : 'warn'}">${last.mode === 'listen' ? '🎧 ' : ''}${last.mcq.ok}/${last.mcq.n}</span>` : ''}</div></a></li>`;
          })
          .join('')}</ul>`
      )
      .join('')}`;
}

let RS = null;
const WORD_RE = /([A-Za-zА-Яа-яЁё́]+(?:-[A-Za-zА-Яа-яЁё́]+)*)/;
function wrapWords(text, unknown) {
  return text
    .split(WORD_RE)
    .map((part, i) => (i % 2 ? `<span class="w${unknown.has(norm(part)) ? ' unk' : ''}" data-w="${esc(part)}">${ruText(part)}</span>` : esc(part)))
    .join('');
}

async function viewReading(id) {
  const r = await fetchJSON(`data/reading/${id}.json`);
  const gl = {};
  Object.entries(r.glossary || {}).forEach(([k, v]) => (gl[norm(k)] = { ...v, key: k }));
  RS = { r, gl, mode: RS && RS.r.id === id ? RS.mode : 'read', checked: false, textShown: true, marked: new Set(), slow: false };
  RS.textShown = RS.mode === 'read';
  renderReading();
}

function renderReading() {
  const { r } = RS;
  const unknown = new Set(Object.keys(LS.get('unknown', {})));
  const text = r.paragraphs.map((p, i) => `<p data-p="${i}">${wrapWords(p, unknown)}</p>`).join('');
  const qs = r.questions
    .map((q, i) => {
      if (q.type === 'mcq')
        return `<div class="rq" data-q="${i}"><div class="p">${i + 1}. ${ruText(q.prompt)}</div>${q.options
          .map((o, k) => `<label><input type="radio" name="q${i}" value="${k}"><span class="${/[А-Яа-я]/.test(o) ? 'ru' : ''}">${ruText(o)}</span></label>`)
          .join('')}<div class="fbx"></div></div>`;
      const ph = q.type === 'translate' ? 'По-русски…' : 'Напишите здесь…';
      return `<div class="rq" data-q="${i}"><div class="p">${i + 1}. ${q.type === 'translate' ? `Translate: <span class="en">${esc(q.prompt)}</span>` : `${ruText(q.prompt)}${q.en ? `<div class="small muted">${esc(q.en)}</div>` : ''}`}</div>
        <textarea class="answer" lang="ru" rows="${q.type === 'open' ? 4 : 2}" placeholder="${ph}"></textarea><div class="fbx"></div></div>`;
    })
    .join('');
  const listen = RS.mode === 'listen';
  main.innerHTML = `
    <p class="small" style="margin:4px 2px 10px"><a href="#read">← Read &amp; listen</a></p>
    <section class="card">
      <div class="row between"><span class="lvl">${esc(r.level)}</span><div class="seg"><button class="${!listen ? 'on' : ''}" data-act="r-mode" data-m="read">Read</button><button class="${listen ? 'on' : ''}" data-act="r-mode" data-m="listen">Listen first</button></div></div>
      <h2 class="ru" style="margin-top:12px">${ruText(r.title)}</h2><div class="muted small">${esc(r.title_en)} · ${esc(r.topic)}</div>
      <div class="player" style="margin-top:14px">
        ${listen && !RS.textShown
          ? `<button class="big-play" data-act="r-play" aria-label="Play">${ICON.play}</button>`
          : `<button class="btn sm" data-act="r-play">${ICON.play.replace('<svg', '<svg width="16" height="16"')} Read aloud</button>`}
        <button class="btn sm" data-act="r-stop">${ICON.stop.replace('<svg', '<svg width="16" height="16"')} Stop</button>
        <button class="btn sm ${RS.slow ? 'primary' : ''}" data-act="r-slow">Slow</button>
      </div>
      <p id="rhint" class="small muted" style="margin-top:14px" ${RS.textShown ? 'hidden' : ''}>Listen as many times as you like, then answer the questions. The text appears after you check your answers.</p>
      <div id="rtext" class="text" style="margin-top:14px" ${RS.textShown ? '' : 'hidden'}>${text}</div>
    </section>
    <section class="card"><div class="eyebrow">Questions</div>${qs}
      <button class="btn primary block" data-act="r-check" ${RS.checked ? 'disabled' : ''}>Check answers</button>
      ${listen && !RS.textShown ? `<button id="rshow" class="btn ghost block" data-act="r-show">Show the text now</button>` : ''}
    </section>`;
  main.querySelectorAll('.text .w').forEach(el => el.addEventListener('click', () => wordPopup(el)));
}
function revealText() {
  RS.textShown = true;
  const t = document.getElementById('rtext');
  if (t) t.hidden = false;
  document.getElementById('rhint')?.setAttribute('hidden', '');
  document.getElementById('rshow')?.remove();
}

function wordPopup(el) {
  const raw = el.dataset.w;
  const key = norm(raw);
  let entry = RS.gl[key];
  if (!entry) entry = Object.values(RS.gl).find(v => norm(v.key).split(' ').includes(key));
  const unknown = LS.get('unknown', {});
  const isUnk = !!unknown[key];
  document.querySelectorAll('.w.sel').forEach(x => x.classList.remove('sel'));
  el.classList.add('sel');
  const lookup = `https://en.wiktionary.org/wiki/${encodeURIComponent(stripStress(raw).toLowerCase())}#Russian`;
  openSheet(`
    <div class="row between"><div class="sheet-word">${ruText(raw)}</div>${sayBtn(raw)}</div>
    ${entry
      ? `<div class="big-en" style="margin:6px 0 2px">${esc(entry.en)}</div>${entry.note ? `<div class="note">${esc(entry.note)}</div>` : ''}${norm(entry.key) !== key ? `<div class="small muted">in: <span class="ru">${esc(entry.key)}</span></div>` : ''}`
      : `<p class="muted small">Not in this text's glossary.</p>`}
    <div class="row gap" style="margin-top:14px">
      <button class="btn ${isUnk ? '' : 'primary'}" data-act="w-unk" data-w="${esc(raw)}">${isUnk ? 'Unmark' : "I didn't know this"}</button>
      <a class="btn" href="${lookup}" target="_blank" rel="noopener">Wiktionary</a>
      <button class="btn ghost" data-act="close-sheet">Close</button>
    </div>`);
}
ACT['w-unk'] = el => {
  const raw = el.dataset.w;
  const key = norm(raw);
  const unknown = LS.get('unknown', {});
  if (unknown[key]) {
    delete unknown[key];
    RS.marked.delete(key);
  } else {
    const para = RS.r.paragraphs.find(p => norm(p).split(' ').includes(key)) || '';
    const sent = splitSentences(para).find(s => norm(s).split(' ').includes(key)) || '';
    unknown[key] = { w: raw, ctx: sent.slice(0, 160), src: RS.r.id, ts: Date.now() };
    RS.marked.add(key);
  }
  LS.set('unknown', unknown);
  document.querySelectorAll('.text .w').forEach(w => w.classList.toggle('unk', !!unknown[norm(w.dataset.w)]));
  closeSheet();
};
ACT['r-mode'] = el => {
  RS.mode = el.dataset.m;
  RS.textShown = RS.mode === 'read';
  RS.checked = false;
  RS.peeked = false;
  TTS.stop();
  renderReading();
};
ACT['r-play'] = () => {
  const rate = settings().rate * (RS.slow ? 0.75 : 1);
  TTS.speak(RS.r.paragraphs.join('\n'), { rate });
};
ACT['r-stop'] = () => TTS.stop();
ACT['r-slow'] = el => {
  RS.slow = !RS.slow;
  el.classList.toggle('primary', RS.slow);
};
ACT['r-show'] = () => {
  RS.peeked = true;
  revealText();
};
function collectReadingAnswers() {
  return RS.r.questions.map((q, i) => {
    const box = main.querySelector(`.rq[data-q="${i}"]`);
    if (!box) return null;
    if (q.type === 'mcq') {
      const c = box.querySelector('input:checked');
      return c ? Number(c.value) : null;
    }
    return box.querySelector('textarea').value.trim();
  });
}
ACT['r-check'] = () => {
  const ans = collectReadingAnswers();
  let n = 0;
  let ok = 0;
  const free = [];
  RS.r.questions.forEach((q, i) => {
    const box = main.querySelector(`.rq[data-q="${i}"]`);
    const fbx = box.querySelector('.fbx');
    if (q.type === 'mcq') {
      n++;
      const right = ans[i] === q.answer;
      if (right) ok++;
      box.querySelectorAll('label').forEach((lab, k) => {
        if (k === q.answer) lab.classList.add('right');
        else if (k === ans[i]) lab.classList.add('wrong');
        lab.querySelector('input').disabled = true;
      });
      if (q.explain) fbx.innerHTML = `<div class="note">${esc(q.explain)}</div>`;
    } else {
      const given = ans[i] || '';
      if (given) free.push({ type: q.type, prompt: q.prompt.slice(0, 160), given });
      if (q.type === 'translate') {
        const exact = q.answer.some(a => norm(a) === norm(given));
        fbx.innerHTML = `<div class="fb ${exact ? 'ok' : 'mid'}"><b class="head">${exact ? '✓ Exactly right' : 'Model answers'}</b><div class="ru">${q.answer.map(ruText).join('<br>')}</div></div>`;
      } else fbx.innerHTML = `<div class="note">${given ? 'Saved. Claude gives feedback on this when you send your report.' : 'Optional: write a few sentences and Claude will correct them.'}</div>`;
    }
  });
  const totalWords = words(RS.r.paragraphs.join(' '));
  const unknown = LS.get('unknown', {});
  const unkHere = new Set(norm(RS.r.paragraphs.join(' ')).split(' ').filter(w => unknown[w]));
  const res = {
    id: RS.r.id, title: RS.r.title, level: RS.r.level, mode: RS.mode, peeked: !!RS.peeked, date: today(), ts: Date.now(),
    mcq: { n, ok }, words: totalWords, unknown: unkHere.size, unknownWords: [...unkHere].slice(0, 40), free,
  };
  const all = LS.get('reading', []);
  all.push(res);
  LS.set('reading', all.slice(-200));
  markActive();
  RS.checked = true;
  const btn = main.querySelector('[data-act="r-check"]');
  btn.disabled = true;
  const wasHidden = !RS.textShown;
  btn.insertAdjacentHTML(
    'afterend',
    `<div class="fb ${pct(ok, n) >= 80 ? 'ok' : 'mid'}"><b class="head">${ok} / ${n} correct${RS.mode === 'listen' ? ' (listening)' : ''}</b>${RS.mode === 'read' ? `<div class="small">Unknown words marked: ${unkHere.size} of ${totalWords} (${((100 * unkHere.size) / Math.max(1, totalWords)).toFixed(1)}%). Comfortable reading needs about 95% known words.</div>` : '<div class="small">The text is shown above now. Tap the words you didn\'t catch.</div>'}</div>`
  );
  if (wasHidden) revealText();
};

/* ======================================================================
   Practice: writing, speaking, shadowing
   ====================================================================== */
async function viewPractice() {
  const [wr, sp] = await Promise.all([fetchJSON('data/writing.json').catch(() => ({ prompts: [] })), fetchJSON('data/speaking.json').catch(() => ({ topics: [] }))]);
  const drafts = LS.get('writing', {});
  const list = (items, route, extra) =>
    `<ul class="list">${items
      .map(
        it => `<li><a class="list-item" href="#${route}/${esc(it.id)}"><div><div class="title">${esc(it.title)}</div><div class="sub ru">${ruText(it.prompt_ru)}</div></div><div class="right"><span class="lvl">${esc(it.level)}</span>${extra(it)}</div></a></li>`
      )
      .join('')}</ul>`;
  main.innerHTML = `<h1 class="page">Practice</h1>
    <a class="list-item" href="#shadow" style="border-color:var(--accent)"><div><div class="title">Shadowing</div><div class="sub">Listen, repeat, record yourself, compare. Trains pronunciation and speaking flow.</div></div><div class="right">${ICON.mic.replace('<svg', '<svg width="22" height="22"')}</div></a>
    <h2 class="section">Writing</h2>
    <p class="small muted" style="margin:-4px 4px 10px">Write here, then copy it to Claude for correction and a level check.</p>
    ${list(wr.prompts, 'write', it => (drafts[it.id] && drafts[it.id].text ? `<span class="badge ${drafts[it.id].sent ? 'ok' : 'warn'}">${drafts[it.id].sent ? 'sent' : 'draft'}</span>` : ''))}
    <h2 class="section">Speaking with Claude</h2>
    <p class="small muted" style="margin:-4px 4px 10px">Pick a topic, copy the prompt, and start a voice conversation with Claude.</p>
    ${list(sp.topics, 'speak', () => '')}
    <h2 class="section">More</h2>
    <ul class="list"><li><a class="list-item" href="#report"><div class="title">Progress &amp; report for Claude</div></a></li>
    <li><a class="list-item" href="#settings"><div class="title">Settings &amp; backup</div></a></li></ul>`;
}

async function viewWrite(id) {
  const wr = await fetchJSON('data/writing.json');
  const p = wr.prompts.find(x => x.id === id);
  if (!p) throw new Error(`Unknown prompt "${id}"`);
  const drafts = LS.get('writing', {});
  const d = drafts[id] || { text: '' };
  main.innerHTML = `
    <p class="small" style="margin:4px 2px 10px"><a href="#practice">← Practice</a></p>
    <section class="card">
      <div class="row between"><span class="lvl">${esc(p.level)}</span><span class="small muted">at least ${p.min_words || 50} words</span></div>
      <h2 style="margin-top:10px">${esc(p.title)}</h2>
      <div class="big-ru" style="font-size:1.2rem">${ruText(p.prompt_ru)}</div>
      <div class="en small">${esc(p.prompt_en)}</div>
      ${(p.tips || []).length ? `<div class="eyebrow" style="margin-top:12px">Useful</div><ul class="tips">${p.tips.map(t => `<li>${ruText(t)}</li>`).join('')}</ul>` : ''}
      ${(p.focus || []).length ? `<div style="margin-top:10px">${p.focus.map(t => tagChip(t)).join('')}</div>` : ''}
      <textarea id="wtext" class="answer" lang="ru" rows="10" autocapitalize="sentences" placeholder="Пишите здесь…">${esc(d.text)}</textarea>
      <div id="wc" class="wc"></div>
      <div class="row gap"><button class="btn primary" data-act="w-copy" data-id="${esc(id)}">Copy for Claude</button><button class="btn ghost" data-act="w-clear" data-id="${esc(id)}">Clear</button></div>
      <p class="small muted">Saved on this phone as you type. Your text never goes into the public repo.</p>
    </section>`;
  const ta = document.getElementById('wtext');
  const wc = document.getElementById('wc');
  const upd = () => {
    const n = words(ta.value);
    wc.textContent = `${n} words`;
    wc.classList.toggle('ok', n >= (p.min_words || 50));
  };
  ta.addEventListener('input', () => {
    const all = LS.get('writing', {});
    all[id] = { text: ta.value, updated: Date.now(), sent: false, level: p.level, title: p.title };
    LS.set('writing', all);
    upd();
  });
  upd();
}
ACT['w-copy'] = async el => {
  const id = el.dataset.id;
  const wr = await fetchJSON('data/writing.json');
  const p = wr.prompts.find(x => x.id === id);
  const text = document.getElementById('wtext').value.trim();
  if (!text) return toast('Write something first.');
  const ok = await copyText(
    `Russian writing for correction (prompt ${id}, ${p.level}, min ${p.min_words} words):\n«${p.prompt_ru}» (${p.prompt_en})\n\n${text}\n\nPlease correct it with the Russian Coach correction format, tag every error, count errors per 100 words, estimate the CEFR level of this text, and update my profile and cards.`
  );
  if (ok) {
    const all = LS.get('writing', {});
    if (all[id]) {
      all[id].sent = true;
      LS.set('writing', all);
    }
    markActive();
  }
};
ACT['w-clear'] = el => {
  if (el.dataset.confirm !== '1') {
    el.dataset.confirm = '1';
    el.textContent = 'Tap again to clear';
    return;
  }
  const all = LS.get('writing', {});
  delete all[el.dataset.id];
  LS.set('writing', all);
  document.getElementById('wtext').value = '';
  document.getElementById('wc').textContent = '0 words';
  el.dataset.confirm = '';
  el.textContent = 'Clear';
};

async function viewSpeak(id) {
  const sp = await fetchJSON('data/speaking.json');
  const t = sp.topics.find(x => x.id === id);
  if (!t) throw new Error(`Unknown topic "${id}"`);
  main.innerHTML = `
    <p class="small" style="margin:4px 2px 10px"><a href="#practice">← Practice</a></p>
    <section class="card">
      <span class="lvl">${esc(t.level)}</span>
      <h2 style="margin-top:10px">${esc(t.title)}</h2>
      <div class="big-ru" style="font-size:1.2rem">${ruText(t.prompt_ru)}</div><div class="en small">${esc(t.prompt_en)}</div>
      <div class="eyebrow" style="margin-top:14px">Claude will ask things like</div>
      <ul class="tips">${(t.questions || []).map(q => `<li>${ruText(q)}</li>`).join('')}</ul>
      <div class="eyebrow" style="margin-top:14px">Phrases to use</div>
      <div>${(t.phrases || []).map(ph => `<div class="phrase"><div><div class="ru">${ruText(ph.ru)}</div><div class="small muted">${esc(ph.en)}</div></div>${sayBtn(ph.ru)}</div>`).join('')}</div>
      <button class="btn primary block" data-act="sp-copy" data-id="${esc(id)}">Copy prompt for Claude</button>
      <p class="small muted">Then open Claude, start voice mode and paste or say the prompt. Afterwards ask Claude to assess the conversation and update your profile.</p>
    </section>`;
}
ACT['sp-copy'] = async el => {
  const sp = await fetchJSON('data/speaking.json');
  const t = sp.topics.find(x => x.id === el.dataset.id);
  copyText(
    `Russian speaking session (topic ${t.id}, ${t.level}): «${t.title}». Talk with me in Russian at my level: ask the questions one at a time, keep your turns short, and push me to answer in full sentences. Don't correct me during the conversation; at the end, list my main errors with corrections and assess my speaking with the Russian Coach rubric.`
  );
};

/* ---------- shadowing ---------- */
let SH = null;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function viewShadow() {
  const srs = LS.get('srs', {});
  const focus = new Set(S.profile.focus || []);
  const cards = (S.deck.cards || []).filter(c => words(c.ru) >= 3);
  const seen = shuffle(cards.filter(c => srs[c.id]));
  const hot = shuffle(cards.filter(c => !srs[c.id] && c.tags.some(t => focus.has(t))));
  const rest = shuffle(cards.filter(c => !srs[c.id] && !c.tags.some(t => focus.has(t))));
  SH = { pool: [...seen, ...hot, ...rest].map(c => c.id), i: 0, rec: null, url: null, heard: null, listening: false, count: 0 };
  renderShadow();
}
function renderShadow() {
  const c = cardById(SH.pool[SH.i]);
  if (!c) {
    main.innerHTML = `<section class="card">No sentences available yet.</section>`;
    return;
  }
  const recording = SH.rec && SH.rec.state === 'recording';
  const canRec = !!(navigator.mediaDevices && window.MediaRecorder);
  let heard = '';
  if (SH.heard != null) {
    const d = wordDiff(SH.heard, c.ru);
    heard = `<div class="fb ${d.score >= 0.85 ? 'ok' : d.score >= 0.6 ? 'mid' : 'bad'}"><b class="head">Recognised: ${Math.round(d.score * 100)}% match</b>
      <div class="diff">${d.a.map(w => (w.ok ? esc(w.w) : `<span class="x">${esc(w.w)}</span>`)).join(' ') || '<span class="muted">nothing</span>'}</div>
      <div class="small muted">Speech recognition is a rough check, not a pronunciation grade.</div></div>`;
  }
  main.innerHTML = `
    <p class="small" style="margin:4px 2px 10px"><a href="#practice">← Practice</a></p>
    <section class="card">
      <div class="row between small muted"><span>Shadowing · ${SH.count} done</span><span class="lvl">${esc(c.level)}</span></div>
      <div class="big-ru" style="margin-top:12px">${ruText(c.ru)}</div>
      <div class="en small">${esc(c.en)}</div>
      <ol class="small muted" style="padding-left:18px;margin:12px 0">
        <li>Listen (use Slow first).</li><li>Say it out loud along with the audio, then alone.</li><li>Record yourself and compare.</li>
      </ol>
      <div class="row gap">
        <button class="btn primary" data-act="sh-play">${ICON.play.replace('<svg', '<svg width="16" height="16"')} Listen</button>
        <button class="btn" data-act="sh-slow">Slow</button>
        ${canRec ? `<button class="btn ${recording ? 'danger' : ''}" data-act="sh-rec">${recording ? '<span class="rec-dot"></span> Stop' : `${ICON.mic.replace('<svg', '<svg width="16" height="16"')} Record`}</button>` : ''}
        ${SH.url ? `<button class="btn" data-act="sh-me">${ICON.play.replace('<svg', '<svg width="16" height="16"')} My recording</button>` : ''}
        ${SR ? `<button class="btn ghost" data-act="sh-check" ${SH.listening ? 'disabled' : ''}>${SH.listening ? 'Listening…' : 'Check with recognition'}</button>` : ''}
      </div>
      ${heard}
      <button class="btn block" data-act="sh-next">Next sentence</button>
    </section>`;
}
ACT['sh-play'] = () => TTS.speak(cardById(SH.pool[SH.i]).ru);
ACT['sh-slow'] = () => TTS.speak(cardById(SH.pool[SH.i]).ru, { rate: settings().rate * 0.7 });
ACT['sh-rec'] = async () => {
  if (SH.rec && SH.rec.state === 'recording') {
    SH.rec.stop();
    return;
  }
  try {
    TTS.stop();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    const chunks = [];
    mr.ondataavailable = e => e.data.size && chunks.push(e.data);
    mr.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      if (SH.url) URL.revokeObjectURL(SH.url);
      SH.url = URL.createObjectURL(new Blob(chunks, { type: mr.mimeType || 'audio/mp4' }));
      SH.rec = null;
      if (location.hash === '#shadow') renderShadow();
    };
    mr.start();
    SH.rec = mr;
    renderShadow();
  } catch (e) {
    toast(`Microphone not available (${e.message || e.name}).`);
  }
};
ACT['sh-me'] = () => {
  if (SH.url) new Audio(SH.url).play().catch(() => toast('Could not play the recording.'));
};
ACT['sh-check'] = () => {
  try {
    TTS.stop();
    const r = new SR();
    r.lang = 'ru-RU';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = e => {
      SH.heard = e.results[0][0].transcript;
    };
    r.onerror = e => toast(`Recognition: ${e.error}`);
    r.onend = () => {
      SH.listening = false;
      if (SH.heard == null) SH.heard = '';
      if (location.hash === '#shadow') renderShadow();
    };
    SH.listening = true;
    SH.heard = null;
    renderShadow();
    r.start();
  } catch (e) {
    SH.listening = false;
    toast('Speech recognition is not available here.');
  }
};
ACT['sh-next'] = () => {
  stopRecording();
  SH.count++;
  const log = LS.get('shadow', {});
  log[today()] = (log[today()] || 0) + 1;
  LS.set('shadow', log);
  markActive();
  SH.i = (SH.i + 1) % SH.pool.length;
  if (SH.url) URL.revokeObjectURL(SH.url);
  SH.url = null;
  SH.heard = null;
  renderShadow();
};
function stopRecording() {
  if (SH && SH.rec && SH.rec.state === 'recording') {
    try {
      SH.rec.stop();
    } catch {
      /* ignore */
    }
  }
}

/* ======================================================================
   Progress & report for Claude
   ====================================================================== */
function since() {
  return LS.get('lastReport', 0);
}
function reportBlurb() {
  const s = since();
  const log = LS.get('log', []).filter(x => x.t > s);
  const tests = LS.get('tests', []).filter(x => x.ts > s);
  const reads = LS.get('reading', []).filter(x => x.ts > s);
  if (!log.length && !tests.length && !reads.length) return s ? `Nothing new since your last report (${fmtDay(localDate(new Date(s)))}).` : 'Nothing to report yet. Do some cards or a test first.';
  return `${s ? `Since ${fmtDay(localDate(new Date(s)))}` : 'So far'}: ${plural(log.length, 'review', 'reviews')}, ${plural(tests.length, 'test', 'tests')}, ${plural(reads.length, 'reading', 'readings')}. Paste it into Claude so it can grade and update your level.`;
}

function tagAccuracy(fromTs) {
  const acc = {};
  const add = (tag, ok) => {
    acc[tag] = acc[tag] || { n: 0, ok: 0 };
    acc[tag].n++;
    if (ok) acc[tag].ok++;
  };
  LS.get('log', []).filter(x => x.t > fromTs).forEach(x => (x.tags || []).forEach(t => add(t, x.ok)));
  LS.get('tests', []).filter(x => x.ts > fromTs).forEach(r => r.items.forEach(it => {
    const v = verdict(it);
    if (v !== null && it.tag) add(it.tag, v);
  }));
  return Object.entries(acc).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n);
}

function testSection(r, full) {
  const lv = ['A1', 'A2', 'B1', 'B2', 'C1'].filter(l => r.byLevel[l]).map(l => `${l} ${r.byLevel[l].ok}/${r.byLevel[l].n}`).join(' · ');
  const tg = Object.entries(r.byTag).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n).map(([t, s]) => `${t} ${s.ok}/${s.n}`).join(', ');
  const wrong = r.items.filter(it => verdict(it) === false && it.type !== 'translate');
  const freeA = r.items.filter(it => it.type === 'translate' && it.given);
  let out = `${r.date} ${r.id}: ${r.correct}/${r.total} (${pct(r.correct, r.total)}%)${r.estimate ? ` · provisional grammar estimate ${r.estimate}` : ''}\n  By level: ${lv || '-'}\n  By tag: ${tg || '-'}`;
  const lim = full ? 60 : 25;
  if (wrong.length) out += `\n  Errors:\n${wrong.slice(0, lim).map(it => `  - [q${it.q + 1} ${it.level} ${it.tag}] ${it.prompt} → gave "${it.given || '(no answer)'}", correct "${it.expected}"`).join('\n')}`;
  if (freeA.length) out += `\n  Translations to grade:\n${freeA.map(it => `  - [q${it.q + 1} ${it.level} ${it.tag}] "${it.prompt}" → «${it.given}»${typeof it.self === 'boolean' ? ` (self-marked ${it.self ? 'correct' : 'wrong'})` : ''}${it.ok === true ? ' (exact match)' : ''}`).join('\n')}`;
  return out;
}

function buildReport(all) {
  const s = all ? 0 : since();
  const srs = LS.get('srs', {});
  const log = LS.get('log', []).filter(x => x.t > s);
  const tests = LS.get('tests', []).filter(x => x.ts > s);
  const reads = LS.get('reading', []).filter(x => x.ts > s);
  const writing = Object.entries(LS.get('writing', {})).filter(([, d]) => d.updated > s && d.text && d.text.trim());
  const shadow = Object.entries(LS.get('shadow', {})).filter(([d]) => !s || d >= localDate(new Date(s)));
  const unknown = Object.entries(LS.get('unknown', {})).filter(([, u]) => u.ts > s);
  const days = new Set(log.map(x => localDate(new Date(x.t))));
  const lines = [];
  lines.push('RUSSIAN COACH REPORT');
  lines.push(`Period: ${s ? localDate(new Date(s)) : 'start'} → ${today()} · content ${S.index.version} · streak ${plural(streak(), 'day', 'days')}`);
  lines.push('');
  lines.push('CARDS');
  const okN = log.filter(x => x.ok).length;
  const started = Object.keys(srs).length;
  const mature = Object.values(srs).filter(x => x.interval >= 21).length;
  lines.push(`Reviews: ${log.length} on ${plural(days.size, 'day', 'days')} · accuracy ${pct(okN, log.length)}% · deck ${S.deck.cards.length} cards, started ${started}, mature (≥21d) ${mature}`);
  const tagAcc = {};
  log.forEach(x => (x.tags || []).forEach(t => {
    tagAcc[t] = tagAcc[t] || { n: 0, ok: 0 };
    tagAcc[t].n++;
    if (x.ok) tagAcc[t].ok++;
  }));
  const tagLine = Object.entries(tagAcc).filter(([, v]) => v.n >= 3).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n).map(([t, v]) => `${t} ${pct(v.ok, v.n)}% (${v.n})`).join(' · ');
  if (tagLine) lines.push(`By tag, weakest first: ${tagLine}`);
  const lapsed = Object.entries(srs).filter(([, v]) => v.lapses >= 2).sort((a, b) => b[1].lapses - a[1].lapses).slice(0, 12);
  if (lapsed.length) lines.push(`Hardest cards: ${lapsed.map(([id, v]) => { const c = cardById(id); return c ? `${id} «${c.ru}» (${v.lapses} lapses)` : id; }).join('; ')}`);
  const wrongTyped = log.filter(x => x.given && !x.ok).slice(-15);
  if (wrongTyped.length) lines.push(`Recent wrong answers: ${wrongTyped.map(x => { const c = cardById(x.id); return `${x.id} typed «${x.given}»${c ? ` for «${c.ru}»` : ''}`; }).join('; ')}`);
  lines.push('');
  lines.push('TESTS');
  if (!tests.length) lines.push('(none)');
  tests.forEach(r => lines.push(testSection(r, r.id === 'placement')));
  lines.push('');
  lines.push('READING & LISTENING');
  if (!reads.length) lines.push('(none)');
  reads.forEach(r => {
    const unk = r.mode === 'listen' ? '' : ` · unknown words ${r.unknown}/${r.words} (${((100 * r.unknown) / Math.max(1, r.words)).toFixed(1)}%)${r.unknownWords.length ? `: ${r.unknownWords.join(', ')}` : ''}`;
    lines.push(`${r.date} ${r.id} (${r.level}, ${r.mode === 'listen' ? `listen first${r.peeked ? ', peeked at text' : ''}` : 'read'}): ${r.mcq.ok}/${r.mcq.n} questions${unk}`);
    r.free.forEach(f => lines.push(`  - ${f.type} "${f.prompt}" → «${f.given}»`));
  });
  lines.push('');
  lines.push('WRITING (texts written in the app)');
  if (!writing.length) lines.push('(none)');
  writing.forEach(([id, d]) => lines.push(`${id} (${d.level || '?'}) "${d.title || ''}", ${words(d.text)} words${d.sent ? ', already sent separately' : ''}:\n«${d.text.trim()}»`));
  lines.push('');
  lines.push('SPEAKING');
  const shTotal = shadow.reduce((a, [, n]) => a + n, 0);
  lines.push(shTotal ? `Shadowing: ${shTotal} sentences on ${shadow.length} days` : 'Shadowing: none');
  if (unknown.length) {
    lines.push('');
    lines.push(`UNKNOWN WORDS FROM READING (${unknown.length})`);
    lines.push(unknown.map(([, u]) => `${u.w}${u.ctx ? ` — «${u.ctx}»` : ''}`).join('\n'));
  }
  lines.push('');
  lines.push('Please grade the free answers, update my levels and weak points (only where the evidence rule is met), add cards for my errors and unknown words, and tell me what to focus on next.');
  return lines.join('\n');
}

function viewReport() {
  const acc = tagAccuracy(Date.now() - 30 * 86400000).filter(([, v]) => v.n >= 3);
  const srs = LS.get('srs', {});
  const log30 = LS.get('log', []).filter(x => x.t > Date.now() - 30 * 86400000);
  main.innerHTML = `
    <h1 class="page">Progress &amp; report</h1>
    <section class="card">
      <div class="eyebrow">Last 30 days</div>
      <table class="tbl">
        <tr><td>Reviews</td><td>${log30.length}</td></tr>
        <tr><td>Card accuracy</td><td>${pct(log30.filter(x => x.ok).length, log30.length)}%</td></tr>
        <tr><td>Cards started / in deck</td><td>${Object.keys(srs).length} / ${S.deck.cards.length}</td></tr>
        <tr><td>Day streak</td><td>${streak()}</td></tr>
      </table>
      ${acc.length ? `<div class="eyebrow" style="margin-top:14px">By topic (cards + tests)</div><div class="bars">${acc.slice(0, 12).map(([t, v]) => bar(tagLabel(t), v.ok, v.n)).join('')}</div>` : '<p class="small muted">Topic stats appear after a few reviews and tests.</p>'}
    </section>
    <section class="card">
      <div class="eyebrow">Report for Claude</div>
      <p class="small">${esc(reportBlurb())}</p>
      <div class="seg" style="margin:6px 0"><button class="on" data-act="rep-scope" data-all="0">Since last report</button><button data-act="rep-scope" data-all="1">Everything</button></div>
      <pre class="report" id="rep">${esc(buildReport(false))}</pre>
      <button class="btn primary block" data-act="copy-report">Copy report</button>
      <p class="small muted">After copying, open your Russian chat with Claude and paste it. The next report starts from now.</p>
    </section>`;
}
ACT['rep-scope'] = el => {
  const all = el.dataset.all === '1';
  el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el));
  document.getElementById('rep').textContent = buildReport(all);
  document.getElementById('rep').dataset.all = all ? '1' : '0';
};
ACT['copy-report'] = async () => {
  const pre = document.getElementById('rep');
  const all = pre && pre.dataset.all === '1';
  const ok = await copyText(buildReport(all));
  if (ok) {
    LS.set('lastReport', Date.now());
    if (location.hash === '#home' || location.hash === '') viewHome();
  }
};

/* ======================================================================
   Settings & backup
   ====================================================================== */
function viewSettings() {
  const s = settings();
  const voices = TTS.voices();
  main.innerHTML = `
    <h1 class="page">Settings</h1>
    <section class="card">
      <div class="setting"><div><div class="lbl">New cards per day</div><div class="desc">Due reviews always come first.</div></div><input type="number" min="0" max="60" id="s-new" value="${s.newPerDay}"></div>
      <div class="setting"><div><div class="lbl">Play audio automatically</div><div class="desc">After each card answer.</div></div><label class="switch"><input type="checkbox" id="s-auto" ${s.autoplay ? 'checked' : ''}><span></span></label></div>
      <div class="setting"><div><div class="lbl">English hint on gap cards</div></div><label class="switch"><input type="checkbox" id="s-hints" ${s.hints ? 'checked' : ''}><span></span></label></div>
      <div class="setting"><div><div class="lbl">Show stress marks</div><div class="desc">When the content has them (молоко́).</div></div><label class="switch"><input type="checkbox" id="s-stress" ${s.stress ? 'checked' : ''}><span></span></label></div>
    </section>
    <section class="card">
      <div class="setting"><div><div class="lbl">Speech speed</div><div class="desc" id="s-rate-v">${s.rate.toFixed(2)}×</div></div><input type="range" id="s-rate" min="0.5" max="1.2" step="0.05" value="${s.rate}"></div>
      <div class="setting"><div><div class="lbl">Russian voice</div><div class="desc">${voices.length ? `${voices.length} available` : 'None found. Install a Russian voice in your phone’s text-to-speech settings.'}</div></div>
        <select id="s-voice"><option value="">Default</option>${voices.map(v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === s.voice ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div>
      <button class="btn block" data-act="say" data-text="Привет! Давай говорить по-русски.">Test voice</button>
    </section>
    <section class="card">
      <div class="eyebrow">Your progress data</div>
      <p class="small muted">Progress is stored on this device only. Export a backup now and then, or to move to another phone.</p>
      <div class="row gap"><button class="btn" data-act="backup">Export backup</button><label class="btn">Import backup<input type="file" id="s-import" accept="application/json,.json" hidden></label></div>
      <button class="btn danger block" data-act="reset">Reset all progress</button>
    </section>
    <section class="card">
      <div class="eyebrow">About</div>
      <p class="small">Content ${esc(S.index.version)} (${esc(S.index.built)}): ${S.index.deck} cards, ${S.index.sheets.length} grammar sheets, ${S.index.tests.length} tests, ${S.index.readings.length} readings. Claude updates the content and your profile after your sessions; the app loads the new version automatically when you're online.</p>
      <button class="btn block" data-act="reload">Check for updates</button>
    </section>`;
  const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
  on('s-new', 'change', e => setSetting('newPerDay', Math.max(0, Math.min(60, Number(e.target.value) || 0))));
  on('s-auto', 'change', e => setSetting('autoplay', e.target.checked));
  on('s-hints', 'change', e => setSetting('hints', e.target.checked));
  on('s-stress', 'change', e => setSetting('stress', e.target.checked));
  on('s-rate', 'input', e => {
    setSetting('rate', Number(e.target.value));
    document.getElementById('s-rate-v').textContent = `${Number(e.target.value).toFixed(2)}×`;
  });
  on('s-voice', 'change', e => setSetting('voice', e.target.value));
  on('s-import', 'change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || data.app !== 'russian-coach' || typeof data.data !== 'object') throw new Error('not a Russian Coach backup');
      Object.keys(localStorage).filter(k => k.startsWith('rc:')).forEach(k => localStorage.removeItem(k));
      Object.entries(data.data).forEach(([k, v]) => localStorage.setItem(k, v));
      toast('Backup restored.');
      setTimeout(() => location.reload(), 600);
    } catch (err) {
      toast(`Import failed: ${err.message}`);
    }
  });
  if (TTS.ok && !voices.length) setTimeout(() => location.hash === '#settings' && TTS.voices().length && viewSettings(), 800);
}
ACT.backup = () => {
  const data = {};
  Object.keys(localStorage).filter(k => k.startsWith('rc:')).forEach(k => (data[k] = localStorage.getItem(k)));
  const blob = new Blob([JSON.stringify({ app: 'russian-coach', exported: new Date().toISOString(), data }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `russian-coach-backup-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
};
ACT.reset = el => {
  if (el.dataset.confirm !== '1') {
    el.dataset.confirm = '1';
    el.textContent = 'Tap again to delete all progress on this device';
    return;
  }
  Object.keys(localStorage).filter(k => k.startsWith('rc:')).forEach(k => localStorage.removeItem(k));
  toast('Progress reset.');
  setTimeout(() => (location.hash = '#home'), 400);
};
ACT.reload = () => location.reload();

/* ======================================================================
   Boot
   ====================================================================== */
async function boot() {
  try {
    const [index, profile, deck] = await Promise.all([
      fetchJSON('data/index.json'),
      fetchJSON('data/profile.json'),
      fetchJSON('data/deck.json').catch(() => ({ cards: [] })),
    ]);
    S.index = index;
    S.profile = profile;
    S.deck = deck;
  } catch (e) {
    main.innerHTML = `<section class="card error"><b>Couldn't load the course data.</b><p class="small">${esc(e.message)}</p><p class="small">Check your connection and reload.</p><button class="btn" data-act="reload">Reload</button></section>`;
    return;
  }
  await render();
  setTimeout(prefetchAll, 2000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
