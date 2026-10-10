#!/usr/bin/env node
/*
 * Gets a pull request ready for the automatic review (.github/workflows/review.yml).
 *
 *   node scripts/review-prep.mjs --data pr --base base --changed changed.txt --author <login> --out review
 *
 * Runs main's copy against the pull request's files, which are only read, never run.
 * It decides whether the pull request may merge on its own, and if so fetches every
 * source it links, so the reviewer reads the pages rather than browsing for them.
 *
 * --changed is a file of "<status> <path>" lines: what the pull request changes,
 * from GitHub's compare of the reviewed commit against main.
 *
 * Writes into --out:
 *   gate.json         { eligible, reason, file, isNew, author }
 *   submission.yaml   the file as the pull request has it
 *   before.yaml       the file as main has it (an update only)
 *   grades.md         every listed system's grades, for grading the same way
 *   sources/NN.txt    each source page, with the links to it on the first lines
 *   sources.md        the index of what was fetched, and what couldn't be
 *   review.json       what the reviewer must cover: { mechanisms, unfetched }
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import YAML from "yaml";

const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const DATA = resolve(value("--data"));
const BASE = resolve(value("--base"));
const AUTHOR = value("--author");
const OUT = resolve(value("--out"));
const TOKEN = process.env.GITHUB_TOKEN;
const MAX_FILE = 64_000; // a system's file is a few kilobytes
const MAX_PAGES = 25; // sources fetched per review
const MAX_CHARS = 60_000; // per source: enough for a docs page or a source file
const MAX_TOTAL = 500_000; // across all of them

mkdirSync(join(OUT, "sources"), { recursive: true });
const read = (dir, file) => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8") : null);
const write = (file, text) => writeFileSync(join(OUT, file), text);
const parse = (text) => {
  try {
    const v = YAML.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

/**
 * The pull request's file, read from git rather than the checkout, and only if git
 * stores it as an ordinary file. A symlink would otherwise be followed, and could point
 * at anything on the runner (its environment, say) and hand it to the reviewer.
 */
function prFile(file) {
  const git = (...a) => execFileSync("git", ["-C", DATA, ...a], { encoding: "utf8", maxBuffer: 4 * MAX_FILE });
  const entry = git("ls-tree", "HEAD", "--", file).trim(); // "<mode> blob <sha>\t<path>"
  if (!entry) return { error: "isn't in the pull request" };
  const [mode, type] = entry.split(/\s+/);
  if (mode !== "100644" || type !== "blob") return { error: `is stored as mode ${mode} ${type}, not an ordinary file` };
  const size = Number(git("cat-file", "-s", `HEAD:${file}`).trim());
  if (size > MAX_FILE) return { error: `is ${size} bytes, more than a system's file should be` };
  return { text: git("show", `HEAD:${file}`) };
}

/* ── which files the pull request changes ── */
const changed = readFileSync(resolve(value("--changed")), "utf8").trim().split("\n").filter(Boolean)
  .map((l) => ({ status: l.split(" ")[0], file: l.slice(l.indexOf(" ") + 1) }));

const norm = (s) => String(s ?? "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[\/\s]+$/, "");
function duplicateOf(entry) {
  const mine = new Set([entry.name, entry.links?.website, ...(entry.links?.repos ?? [])].filter(Boolean).map(norm));
  for (const f of readdirSync(join(BASE, "systems")).filter((f) => f.endsWith(".yaml"))) {
    const s = parse(read(BASE, `systems/${f}`));
    if (!s) continue;
    for (const v of [s.name, s.links?.website, ...(s.links?.repos ?? [])].filter(Boolean))
      if (mine.has(norm(v))) return s.name;
  }
  return null;
}

let submission = null;
function gate() {
  if (changed.length !== 1) return { eligible: false, reason: `changes ${changed.length} files; only a change to one system's file merges on its own` };
  const { status, file } = changed[0];
  if (!/^systems\/[a-z0-9-]+\.yaml$/.test(file)) return { eligible: false, reason: `changes \`${file.slice(0, 120)}\`, which only a maintainer merges` };
  if (!["added", "modified"].includes(status)) return { eligible: false, reason: `${status === "removed" ? "removes" : status === "renamed" ? "renames" : `changes (${status})`} \`${file}\``, file };
  const got = prFile(file);
  if (got.error) return { eligible: false, reason: `\`${file}\` ${got.error}`, file };
  const entry = parse(got.text);
  if (!entry) return { eligible: false, reason: `\`${file}\` isn't a readable YAML file`, file };
  submission = got.text;
  const before = read(BASE, file);
  if (before === null) {
    const dup = duplicateOf(entry);
    if (dup) return { eligible: false, reason: `adds \`${file}\`, which looks like ${dup}, already listed`, file };
    return { eligible: true, reason: "adds a new system", file, isNew: true };
  }
  const owner = parse(before)?.confirmed?.by;
  if (typeof owner === "string" && owner.toLowerCase() === String(AUTHOR).toLowerCase())
    return { eligible: true, reason: `updates \`${file}\`, whose page its maker ${owner} confirmed`, file, isNew: false };
  return { eligible: false, reason: `changes \`${file}\`, which isn't the author's own confirmed page`, file, isNew: false };
}
const g = { ...gate(), author: AUTHOR };
write("gate.json", JSON.stringify(g, null, 2));
console.log(`gate: ${g.eligible ? "eligible" : "not eligible"}: ${g.reason}`);
if (!g.eligible) process.exit(0);

write("submission.yaml", submission);
const entry = parse(submission);
const old = g.isNew ? null : parse(read(BASE, g.file));
if (old) write("before.yaml", read(BASE, g.file));

/* ── the grades every listed system has now, so one mechanism is graded one way ── */
const mechanisms = YAML.parse(read(BASE, "mechanisms.yaml")); // main's, so trusted
const rows = [];
for (const f of readdirSync(join(BASE, "systems")).filter((f) => f.endsWith(".yaml")).sort()) {
  if (`systems/${f}` === g.file) continue;
  const s = parse(read(BASE, `systems/${f}`));
  for (const m of mechanisms) {
    const r = s?.mechanisms?.[m.id];
    if (!r) continue;
    rows.push(`| ${m.id} | ${s.name} | ${r.status}${r.depth ? ` ${r.depth}` : ""} | ${(r.note ?? "").replace(/\s+/g, " ").replaceAll("|", "\\|")} |`);
  }
}
rows.sort();
write("grades.md", `# Grades already in the directory\n\n| mechanism | system | grade | note |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n`);

/* ── what has to be reviewed: every built or partial grade, or in an update each one that changed ── */
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const toReview = Object.entries(entry.mechanisms ?? {})
  .filter(([id, r]) => ["built", "partial"].includes(r?.status) && (!old || !same(r, old.mechanisms?.[id])))
  .map(([id, r]) => ({ id, source: typeof r.source === "string" ? r.source : null }));

const urls = new Set();
for (const m of toReview) if (m.source) urls.add(m.source);
for (const s of entry.sources ?? [])
  if (typeof s?.url === "string" && (!old || !(old.sources ?? []).some((o) => o?.url === s.url))) urls.add(s.url);

/* ── fetch each source: GitHub files through the API (authenticated, so not throttled) ── */
function githubFile(url) {
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|tree)\/([^/]+)\/([^#?]+)/);
  return m && { owner: m[1], repo: m[2], ref: m[3], path: m[4] };
}
function githubRepo(url) {
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)\/?(?:[#?].*)?$/);
  return m && { owner: m[1], repo: m[2] };
}
const api = (path, accept = "application/vnd.github.raw+json") =>
  fetch(`https://api.github.com${path}`, {
    headers: { accept, "user-agent": "counterparts-directory-review", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    signal: AbortSignal.timeout(20_000),
  });
/** The body, read no further than a source is ever kept. */
async function body(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < MAX_CHARS * 4) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString("utf8");
}
const plain = (html) =>
  html
    .replace(/<(script|style|nav|footer|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

async function fetchSource(url) {
  if (!url.startsWith("https://")) throw new Error("not an https link");
  const f = githubFile(url);
  if (f) {
    const res = await api(`/repos/${f.owner}/${f.repo}/contents/${f.path}?ref=${encodeURIComponent(f.ref)}`);
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const text = await body(res);
    // A folder comes back as a JSON listing; say what's in it.
    if (text.startsWith("[")) return JSON.parse(text).map((e) => `${e.type} ${e.path}`).join("\n");
    return text;
  }
  const r = githubRepo(url);
  if (r) {
    const res = await api(`/repos/${r.owner}/${r.repo}/readme`);
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    return body(res);
  }
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (counterparts-directory-review)" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text|json|xml|markdown/.test(type)) throw new Error(`not text (${type})`);
  const text = await body(res);
  return /html/.test(type) ? plain(text) : text;
}

// One file per page: links to different sections of one page share it.
const pages = new Map();
for (const url of urls) {
  const page = url.split("#")[0];
  pages.set(page, [...(pages.get(page) ?? []), url]);
}
const index = [];
const unfetched = [];
let n = 0;
let total = 0;
for (const [page, links] of pages) {
  n++;
  const name = `sources/${String(n).padStart(2, "0")}.txt`;
  try {
    if (n > MAX_PAGES || total >= MAX_TOTAL) throw new Error("over the review's limit on sources");
    let text = await fetchSource(page);
    const cut = text.length > MAX_CHARS;
    if (cut) text = text.slice(0, MAX_CHARS);
    total += text.length;
    write(name, `${links.join("\n")}\n\n${text}${cut ? "\n\n[cut here: the source is longer]" : ""}`);
    index.push(`- ${name}${cut ? " (first part only)" : ""}: ${links.join(", ")}`);
  } catch (e) {
    index.push(`- not fetched (${e.message}): ${links.join(", ")}`);
    unfetched.push(...links);
  }
}
write("sources.md", `# Sources\n\n${index.join("\n")}\n`);
write("review.json", JSON.stringify({ mechanisms: toReview.map((m) => m.id), unfetched: toReview.filter((m) => !m.source || unfetched.includes(m.source)).map((m) => m.id) }, null, 2));
console.log(`sources: ${index.filter((l) => !l.startsWith("- not")).length} of ${pages.size} pages fetched; ${toReview.length} grades to review`);
