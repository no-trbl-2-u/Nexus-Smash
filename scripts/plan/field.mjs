// scripts/plan/field.mjs: the field-research rules (spec 59), as functions the research generator and the gate share.
//
// A `field` candidate is the loop's look outward: a pattern seen in how the wider tooling moves, filed into
// plan/CANDIDATES.md with no product names and no URLs, its sources kept in the tick's job summary only. The rules
// that can be mechanical are:
//
//   - a batch is at most MAX_CANDIDATES candidates and MAX_FETCHES fetched sources;
//   - candidate text carries no URL (`urlsIn`) and no product name (`namesIn`: a denylist of well-known names plus a
//     capitalised-word heuristic, because a name no list knows is still a capitalised word mid-sentence);
//   - a `field` candidate already in the queue that carries a URL fails the gate (`checkFieldCandidates`, run by
//     scripts/plan-check.mjs, the chunks leg).
//
// Pure: text in, findings out. No network, no files.

export const MAX_CANDIDATES = 3;
export const MAX_FETCHES = 8;
/** A field signal starts here (below the promote floor) and the generator never files above FIELD_CEILING. */
export const FIELD_SCORE = 4.0;
export const FIELD_CEILING = 6.0;
export const TITLE_MAX = 120;
export const PATTERN_MAX = 280;

const TLD = '(?:com|org|net|io|dev|ai|app|xyz|info|tech|cloud)';
const URL_RES = [
  /\b(?:https?|ftp|ssh|git):\/\/\S+/i,
  /\bwww\.[a-z0-9-]+\.[a-z]{2,}/i,
  new RegExp(`\\b[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.${TLD}\\b(?:[/:?#]\\S*)?`, 'i'),
  /\]\(\s*[^)\s]*\)/, // a markdown link target
  /<https?:[^>]*>/i,
];

/** The URL-looking fragments of a text: schemes, `www.` hosts, bare hosts on common TLDs, markdown link targets. */
export function urlsIn(text = '') {
  const out = [];
  for (const re of URL_RES) {
    const g = new RegExp(re.source, `${re.flags.replace('g', '')}g`);
    for (const m of String(text).matchAll(g)) out.push(m[0]);
  }
  return [...new Set(out)];
}

/** Well-known product and vendor names. Lowercase; matched as whole words, case-insensitively. */
export const DENYLIST = Object.freeze([
  'claude', 'anthropic', 'openai', 'chatgpt', 'gpt', 'codex', 'gemini', 'copilot', 'cursor', 'windsurf', 'devin',
  'aider', 'cline', 'roo', 'jules', 'langchain', 'langgraph', 'llamaindex', 'autogen', 'crewai', 'github', 'gitlab',
  'bitbucket', 'jira', 'linear', 'vercel', 'netlify', 'cloudflare', 'aws', 'azure', 'kubernetes', 'docker', 'slack',
  'discord', 'notion', 'figma', 'sentry', 'datadog', 'huggingface', 'mistral', 'llama', 'deepseek', 'perplexity',
  'replit', 'lovable', 'bolt', 'sourcegraph', 'tabnine', 'coderabbit', 'greptile', 'graphite', 'supabase', 'firebase',
]);

/** Capitalised tokens that are ordinary words or acronyms of the trade, not product names. Lowercase. */
const ALLOWED = new Set([
  'i', 'ci', 'cd', 'pr', 'prs', 'ai', 'api', 'apis', 'llm', 'llms', 'mcp', 'ui', 'ux', 'cli', 'gui', 'sdk', 'sdks', 'json',
  'yaml', 'url', 'urls', 'readme', 'sla', 'ide', 'ides', 'os', 'sql', 'html', 'css', 'http', 'https', 'ssh', 'git', 'npm',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'nexus',
]);

const words = (text) => String(text).split(/[^\p{L}\p{N}'+#-]+/u).filter(Boolean);

/**
 * Product-name findings in a text: the denylist words, and every capitalised word that does not open a sentence
 * (CamelCase and letter-digit names too, `GPT-4`), less the allowed acronyms. `deny` adds names to the list.
 */
export function namesIn(text = '', deny = []) {
  const list = new Set([...DENYLIST, ...deny.map((d) => String(d).trim().toLowerCase()).filter(Boolean)]);
  const found = new Set();
  for (const sentence of String(text).split(/(?<=[.!?:;])\s+|\n+/)) {
    const toks = words(sentence);
    toks.forEach((tok, i) => {
      const bare = tok.replace(/^[-'#+]+|[-'+]+$/g, '');
      if (!bare) return;
      const low = bare.toLowerCase();
      const parts = low.split('-');
      if (list.has(low) || parts.some((p) => list.has(p))) { found.add(bare); return; }
      if (ALLOWED.has(low)) return;
      const camel = /^[A-Za-z]*[a-z][A-Z]/.test(bare) || /^[A-Z][a-z]+[A-Z]/.test(bare);
      const cap = /^[A-Z][a-z]/.test(bare);
      const letterDigit = /^[A-Za-z]{2,}[-]?\d/.test(bare) && /^[A-Z]/.test(bare);
      if (camel || letterDigit || (cap && i > 0)) found.add(bare);
    });
  }
  return [...found];
}

const oneLine = (s) => typeof s === 'string' && s.trim() !== '' && !/[\r\n]/.test(s);

/**
 * Validate a proposed batch: { fetched, sources, items: [{ title, pattern, rationale, scope, chunks? }] }.
 * Returns { ok, errors }. Every rule is mechanical and the whole batch is refused on any error.
 */
export function validateBatch(batch, { deny = [] } = {}) {
  const errors = [];
  if (!batch || typeof batch !== 'object' || Array.isArray(batch)) return { ok: false, errors: ['the batch is not an object'] };
  const items = batch.items;
  if (!Array.isArray(items)) errors.push('items must be an array');
  const fetched = batch.fetched;
  if (!Number.isInteger(fetched) || fetched < 0) errors.push('fetched must be a whole number (how many sources were fetched)');
  else if (fetched > MAX_FETCHES) errors.push(`fetched ${fetched} sources; at most ${MAX_FETCHES}`);
  const sources = batch.sources ?? [];
  if (!Array.isArray(sources) || sources.some((s) => typeof s !== 'string')) errors.push('sources must be an array of strings');
  else {
    if (sources.length > MAX_FETCHES) errors.push(`${sources.length} sources listed; at most ${MAX_FETCHES}`);
    if (Number.isInteger(fetched) && sources.length > fetched) errors.push(`${sources.length} sources listed but fetched says ${fetched}`);
  }
  if (Array.isArray(items)) {
    if (items.length > MAX_CANDIDATES) errors.push(`${items.length} candidates; at most ${MAX_CANDIDATES} per run`);
    items.forEach((it, n) => {
      const at = `item ${n + 1}`;
      if (!it || typeof it !== 'object') return errors.push(`${at}: not an object`);
      if (it.source !== undefined && it.source !== 'field') errors.push(`${at}: source must be field, not ${JSON.stringify(it.source)}`);
      if (!oneLine(it.title)) errors.push(`${at}: title must be one non-empty line`);
      else if (it.title.length > TITLE_MAX) errors.push(`${at}: title is ${it.title.length} characters; at most ${TITLE_MAX}`);
      if (!oneLine(it.pattern)) errors.push(`${at}: pattern must be one non-empty line`);
      else if (it.pattern.length > PATTERN_MAX) errors.push(`${at}: pattern is ${it.pattern.length} characters; at most ${PATTERN_MAX}`);
      for (const k of ['rationale', 'scope']) if (typeof it[k] !== 'string' || !it[k].trim()) errors.push(`${at}: ${k} must be a non-empty string`);
      for (const k of ['title', 'pattern', 'rationale', 'scope', 'chunks']) {
        const v = it[k];
        if (typeof v !== 'string') continue;
        const urls = urlsIn(v);
        if (urls.length) errors.push(`${at}: ${k} carries a URL (${urls[0]}); sources go in the job summary only`);
        const names = namesIn(v, deny);
        if (names.length) errors.push(`${at}: ${k} names a product or vendor (${names.slice(0, 3).join(', ')}); describe the pattern, never the product`);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

/** `Research topics: a; b; c` from bearings text (comments and fenced blocks ignored): the phrases, or []. */
export function parseTopics(bearings = '') {
  const text = String(bearings).replace(/<!--[\s\S]*?-->/g, '').replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1[ \t]*$/gm, '');
  const m = /^[ \t]*(?:[-*][ \t]+)?[*`]*Research topics[*`]*[ \t]*:[*`]*[ \t]*(.+?)[ \t]*$/im.exec(text);
  if (!m) return [];
  return m[1].replace(/[`*]/g, '').split(/[;]/).map((t) => t.trim().replace(/^"|"$/g, '')).filter(Boolean);
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'its', 'has', 'have', 'can', 'one', 'a', 'an', 'of', 'to', 'in', 'on', 'by', 'as', 'at', 'or', 'is']);
const stem = (w) => (w.length > 4 ? w.replace(/(?:ing|ed|es|s|e)$/, '') : w);
const tokens = (s) => new Set(words(String(s).toLowerCase()).filter((w) => w.length > 2 && !STOP.has(w)).map(stem));

/** Token overlap of two titles, 0..1 (Jaccard). */
export function similarity(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both);
}

/** The first of `titles` that `title` re-states (overlap at or over `at`), else null. */
export function known(title, titles, at = 0.6) {
  let best = null;
  let top = 0;
  for (const t of titles) {
    const s = similarity(title, t);
    if (s >= at && s > top) { best = t; top = s; }
  }
  return best;
}

function wrap(prefix, text, width = 62) {
  const out = [];
  let line = prefix;
  for (const w of String(text).trim().split(/\s+/)) {
    if (line.length + w.length + 1 > width && line.trim() !== prefix.trim()) { out.push(line); line = `  ${w}`; } else line += (line.endsWith(' ') || line === prefix ? '' : ' ') + w;
  }
  out.push(line);
  return out;
}

/** The queue row (an array of lines) for one validated item: score at the field floor, stamped for refill. */
export function candidateRow(item, date, name = 'research') {
  return [
    `### [ ] [score ${FIELD_SCORE.toFixed(1)}] ${item.title.trim()}`,
    `- proposed: ${date}`,
    ...wrap('- source signals: ', `field (${date}): ${item.pattern.trim()}`),
    ...wrap('- rationale: ', item.rationale),
    ...wrap('- proposed scope: ', item.scope),
    `- estimated chunks: ${(item.chunks ?? '1 (S)').toString().trim()}`,
    '- conflicts: none',
    `- generator: ${name} · filed ${date}`,
  ];
}

/** The `### ` rows of a queue file's text: [{ title, lines, section }]. */
function rows(text = '') {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let sec = '';
  let cur = null;
  for (const line of lines) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) { sec = h2[1]; cur = null; continue; }
    if (/^###\s/.test(line)) { cur = { title: line.replace(/^###\s+/, ''), lines: [line], section: sec }; out.push(cur); continue; }
    if (cur) cur.lines.push(line);
  }
  return out;
}

/** A row's field text (`- key:` plus its wrapped continuation lines). */
function fieldText(lines, key) {
  const at = lines.findIndex((l) => l.startsWith(`- ${key}:`));
  if (at < 0) return '';
  const out = [lines[at]];
  for (let i = at + 1; i < lines.length && !/^- /.test(lines[i]) && !/^#{2,3}\s/.test(lines[i]); i++) out.push(lines[i]);
  return out.join(' ');
}

/** Whether a queue row is a field candidate: its signals open with `field (<date>)`, or the research generator filed it. */
export function isFieldRow(r) {
  return /^- source signals:\s*field\s*\(\d{4}-\d{2}-\d{2}\)/.test(fieldText(r.lines, 'source signals'))
    || /^- generator:\s*research\b/m.test(r.lines.join('\n'));
}

/** The titles of the field candidates in a queue file's text (the row heading less its `[ ] [score N]` prefix). */
export function fieldTitles(text = '') {
  return rows(text).filter(isFieldRow).map((r) => r.title.replace(/^\[[^\]]*\]\s*\[[^\]]*\]\s*/, '').trim());
}

/** Gate findings for plan/CANDIDATES.md text: every `field` candidate that carries a URL, one line each. */
export function checkFieldCandidates(text = '') {
  const failures = [];
  for (const r of rows(text)) {
    if (!isFieldRow(r)) continue;
    const urls = urlsIn(r.lines.join('\n'));
    if (urls.length) failures.push(`field candidate "${r.title.replace(/^\[[^\]]*\]\s*\[[^\]]*\]\s*/, '').slice(0, 60)}" carries a URL (${urls[0].slice(0, 60)}); sources belong in the job summary only`);
  }
  return failures;
}
