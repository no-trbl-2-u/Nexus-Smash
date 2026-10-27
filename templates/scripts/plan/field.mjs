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

/** File extensions that look like a last label but are source files, not hosts. */
const FILE_EXT = new Set(['md', 'mjs', 'cjs', 'js', 'ts', 'tsx', 'jsx', 'json', 'yml', 'yaml', 'txt', 'css', 'html', 'htm', 'py', 'toml', 'lock', 'log', 'png', 'svg', 'gif', 'jpg']);

/** A text with the usual defangs undone (hxxp, [.], [:], [//]) and compatibility forms folded, so it reads as a link would. */
function refang(text) {
  return String(text).normalize('NFKC')
    .replace(/hxxp/gi, 'http')
    .replace(/[[({]\s*(?:\.|dot)\s*[\])}]/gi, '.')
    .replace(/[[({]\s*:\s*[\])}]/g, ':')
    .replace(/[[({]\s*\/\/\s*[\])}]/g, '//');
}

const HOST = /\b(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+(?<tld>[a-z]{2,}|[A-Z]{2,}|xn--[a-z0-9-]+)\b(?::\d+)?(?:[/?#]\S*)?/g;
const URL_RES = [
  /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, // any scheme
  /\b(?:mailto|tel|data|javascript|file|sms):\S+/gi,
  /\bwww\.[a-z0-9-]+\.[a-z]{2,}\S*/gi,
  /\blocalhost\b(?::\d+)?(?:[/?#]\S*)?/gi,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b(?::\d+)?(?:[/?#]\S*)?/g, // an IPv4 address
  /\]\([^)]*\)?/g, // a markdown link target, however padded
  /<[a-z][a-z0-9+.-]*:[^>]*>/gi,
];

/**
 * The URL-looking fragments of a text: any scheme, defanged forms (hxxps://, example[.]com), mailto: and friends,
 * `www.` hosts, localhost and IP addresses, any dotted host whose last label is letters (not a source file extension),
 * and markdown link targets. The gate's field check uses this same function.
 */
export function urlsIn(text = '') {
  const t = refang(text);
  const out = [];
  for (const re of URL_RES) for (const m of t.matchAll(re)) out.push(m[0]);
  for (const m of t.matchAll(HOST)) if (!FILE_EXT.has(m.groups.tld.toLowerCase())) out.push(m[0]);
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

/** Capitalised tokens that are ordinary words, the kit's own terms, languages, encodings or acronyms of the trade. Lowercase. */
const ALLOWED = new Set([
  'i', 'ci', 'cd', 'pr', 'prs', 'ai', 'api', 'apis', 'llm', 'llms', 'mcp', 'ui', 'ux', 'cli', 'gui', 'sdk', 'sdks', 'json',
  'yaml', 'url', 'urls', 'readme', 'sla', 'ide', 'ides', 'os', 'sql', 'html', 'css', 'http', 'https', 'ssh', 'git', 'npm',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  // the kit's own terms
  'nexus', 'loop', 'loops', 'queue', 'queues', 'plan', 'spec', 'specs', 'chunk', 'chunks', 'candidate', 'candidates', 'audit',
  'expand', 'iterate', 'march', 'triage', 'oversight', 'digest', 'bearings', 'generator', 'generators', 'refill', 'field',
  'research', 'gate', 'kit', 'tick', 'dial', 'pending', 'promoted', 'rejected', 'archive', 'critique', 'lessons',
  // languages, runtimes, encodings, systems
  'node', 'nodejs', 'javascript', 'typescript', 'python', 'rust', 'go', 'java', 'ruby', 'bash', 'powershell', 'shell',
  'utf', 'utf-8', 'utf8', 'utf-16', 'unicode', 'ascii', 'linux', 'windows', 'macos', 'unix', 'posix', 'markdown', 'xml', 'csv',
]);

const words = (text) => String(text).split(/[^\p{L}\p{N}'+#-]+/u).filter(Boolean);

/** Cyrillic and Greek letters that read as Latin ones. */
const CONFUSABLE = { а: 'a', в: 'b', с: 'c', е: 'e', н: 'h', і: 'i', к: 'k', м: 'm', о: 'o', р: 'p', ѕ: 's', т: 't', у: 'y', х: 'x', α: 'a', ο: 'o', ρ: 'p', ν: 'v', ε: 'e', ι: 'i', κ: 'k', τ: 't', υ: 'u', χ: 'x' };
const fold = (s) => s.replace(/[Ѐ-ӿͰ-Ͽ]/g, (c) => CONFUSABLE[c.toLowerCase()] ?? c);
const compact = (s) => fold(s.toLowerCase()).replace(/[-_']/g, '').replace(/\d+$/, '');

/**
 * Product-name findings in a text: denylist words (also as possessives, spaced, hyphenated or digit-suffixed, `Open
 * AI`, `gpt4`; mixed Latin and Cyrillic or Greek letters are flagged outright), and every capitalised word that does
 * not open a sentence or a quotation (CamelCase and letter-digit names too, `GPT-4`), less the allowed terms. `deny`
 * adds names. With `title: true` a Title Case line is not read for capitalised words (the denylist still applies).
 */
export function namesIn(text = '', deny = [], { title = false } = {}) {
  const list = new Set([...DENYLIST, ...deny.map((d) => compact(String(d).trim())).filter(Boolean)]);
  const found = new Set();
  const flat = String(text).normalize('NFKC').replace(/['’‘]s\b/gi, '');
  for (const sentence of flat.split(/(?<=[.!?:;])\s+|\n+|["“”‘([]/)) {
    const toks = words(sentence);
    const titleCase = title && toks.length >= 2 && toks.filter((w) => w.length > 3).every((w) => /^[A-Z]/.test(w));
    toks.forEach((tok, i) => {
      const bare = tok.replace(/^[-'#+]+|[-'+]+$/g, '');
      if (!bare) return;
      if (/\p{Script=Latin}/u.test(bare) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(bare)) { found.add(bare); return; }
      const low = bare.toLowerCase();
      const comp = compact(bare);
      const pair = toks[i + 1] ? compact(bare + toks[i + 1]) : '';
      const single = list.has(comp) || list.has(low) || low.split('-').some((p) => list.has(compact(p)));
      if (single || (pair && list.has(pair))) { found.add(single ? bare : `${bare} ${toks[i + 1]}`); return; }
      if (ALLOWED.has(low)) return;
      const camel = /^[A-Za-z]*[a-z][A-Z]/.test(bare) || /^[A-Z][a-z]+[A-Z]/.test(bare);
      const cap = /^[A-Z][a-z]/.test(bare);
      const letterDigit = /^[A-Za-z]{2,}[-]?\d/.test(bare) && /^[A-Z]/.test(bare);
      if (camel || letterDigit || (cap && i > 0 && !titleCase)) found.add(bare);
    });
  }
  return [...found];
}

const oneLine = (s) => typeof s === 'string' && s.trim() !== '' && !/[\p{Cc}\u2028\u2029]/u.test(s);
export const CHUNKS_RE = /^\d+(?:-\d+)? \([SML]\)$/;

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
      for (const [k, max] of [['title', TITLE_MAX], ['pattern', PATTERN_MAX], ['rationale', 400], ['scope', 400]]) {
        if (!oneLine(it[k])) errors.push(`${at}: ${k} must be one non-empty line of plain text`);
        else if (it[k].length > max) errors.push(`${at}: ${k} is ${it[k].length} characters; at most ${max}`);
      }
      if (it.chunks !== undefined && !(typeof it.chunks === 'string' && CHUNKS_RE.test(it.chunks))) errors.push(`${at}: chunks must look like "2 (M)" or "1-2 (S)"`);
      for (const k of ['title', 'pattern', 'rationale', 'scope', 'chunks']) {
        const v = it[k];
        if (typeof v !== 'string') continue;
        const urls = urlsIn(v);
        if (urls.length) errors.push(`${at}: ${k} carries a URL (${urls[0]}); sources go in the job summary only`);
        const names = namesIn(v, deny, { title: k === 'title' });
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
export function candidateRow(raw, date, name = 'research') {
  const flat = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const item = { title: flat(raw.title), pattern: flat(raw.pattern), rationale: flat(raw.rationale), scope: flat(raw.scope), chunks: flat(raw.chunks) || '1 (S)' };
  return [
    `### [ ] [score ${FIELD_SCORE.toFixed(1)}] ${item.title.trim()}`,
    `- proposed: ${date}`,
    ...wrap('- source signals: ', `field (${date}): ${item.pattern.trim()}`),
    ...wrap('- rationale: ', item.rationale),
    ...wrap('- proposed scope: ', item.scope),
    `- estimated chunks: ${item.chunks}`,
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
  return /^- source signals:\s*field\s*\(\d{4}-\d{2}-\d{2}\)/i.test(fieldText(r.lines, 'source signals'))
    || /^- generator:\s*research\b/im.test(r.lines.join('\n'));
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
