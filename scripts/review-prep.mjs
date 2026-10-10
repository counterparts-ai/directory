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
 * Writes into --out:
 *   gate.json         { eligible, reason, file, isNew, author }
 *   submission.yaml   the file as the pull request has it
 *   before.yaml       the file as main has it (an update only)
 *   grades.md         every listed system's grades, for grading the same way
 *   sources/NN.txt    each source page, with the links to it on the first lines
 *   sources.md        the index of what was fetched, and what couldn't be
 */
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
const MAX_CHARS = 60_000; // per source: enough for a docs page or a source file

mkdirSync(join(OUT, "sources"), { recursive: true });
const read = (dir, file) => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8") : null);
const write = (file, text) => writeFileSync(join(OUT, file), text);

/* ── which files the pull request changes, as GitHub lists them (against where the branch began) ── */
// --changed is a file of "<status> <path>" lines, from the pull request's files API.
const changed = readFileSync(resolve(value("--changed")), "utf8").trim().split("\n").filter(Boolean)
  .map((l) => ({ status: l.split(" ")[0], file: l.slice(l.indexOf(" ") + 1) }));

function gate() {
  if (changed.length !== 1) return { eligible: false, reason: `changes ${changed.length} files (${changed.map((c) => c.file).join(", ")}); only a change to one system's file merges on its own` };
  const { status, file } = changed[0];
  if (!/^systems\/[a-z0-9-]+\.yaml$/.test(file)) return { eligible: false, reason: `changes ${file}, which only a maintainer merges` };
  if (!["added", "modified"].includes(status) || read(DATA, file) === null) return { eligible: false, reason: `${status === "removed" ? "removes" : "renames"} ${file}`, file };
  const before = read(BASE, file);
  if (before === null) return { eligible: true, reason: "adds a new system", file, isNew: true };
  const owner = YAML.parse(before)?.confirmed?.by;
  if (owner && owner.toLowerCase() === AUTHOR.toLowerCase())
    return { eligible: true, reason: `updates ${file}, whose page its maker ${owner} confirmed`, file, isNew: false };
  return { eligible: false, reason: `changes ${file}, which isn't the author's own confirmed page; a maintainer reviews it`, file, isNew: false };
}
const g = { ...gate(), author: AUTHOR };
write("gate.json", JSON.stringify(g, null, 2));
console.log(`gate: ${g.eligible ? "eligible" : "not eligible"}: ${g.reason}`);
if (!g.eligible) process.exit(0);

const text = read(DATA, g.file);
write("submission.yaml", text);
if (!g.isNew) write("before.yaml", read(BASE, g.file));

/* ── the grades every listed system has now, so one mechanism is graded one way ── */
const mechanisms = YAML.parse(read(BASE, "mechanisms.yaml"));
const rows = [];
for (const f of readdirSync(join(BASE, "systems")).filter((f) => f.endsWith(".yaml")).sort()) {
  if (`systems/${f}` === g.file) continue;
  const s = YAML.parse(read(BASE, `systems/${f}`));
  for (const m of mechanisms) {
    const r = s.mechanisms?.[m.id];
    if (!r) continue;
    rows.push(`| ${m.id} | ${s.name} | ${r.status}${r.depth ? ` ${r.depth}` : ""} | ${(r.note ?? "").replace(/\s+/g, " ").replaceAll("|", "\\|")} |`);
  }
}
rows.sort();
write("grades.md", `# Grades already in the directory\n\n| mechanism | system | grade | note |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n`);

/* ── fetch each source: GitHub files through the API (authenticated, so not throttled) ── */
const entry = YAML.parse(text);
const urls = new Set();
for (const r of Object.values(entry.mechanisms ?? {})) if (r?.source) urls.add(r.source);
for (const s of entry.sources ?? []) if (s?.url) urls.add(s.url);
if (!g.isNew) {
  // An update: only the sources it adds or changes need reading.
  const old = YAML.parse(read(BASE, g.file));
  for (const r of Object.values(old.mechanisms ?? {})) if (r?.source) urls.delete(r.source);
  for (const s of old.sources ?? []) if (s?.url) urls.delete(s.url);
}

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
  });
const plain = (html) =>
  html
    .replace(/<(script|style|nav|footer|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

async function fetchSource(url) {
  const f = githubFile(url);
  if (f) {
    const res = await api(`/repos/${f.owner}/${f.repo}/contents/${f.path}?ref=${encodeURIComponent(f.ref)}`);
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const body = await res.text();
    // A folder comes back as a JSON listing; say what's in it.
    if (body.startsWith("[")) return JSON.parse(body).map((e) => `${e.type} ${e.path}`).join("\n");
    return body;
  }
  const r = githubRepo(url);
  if (r) {
    const res = await api(`/repos/${r.owner}/${r.repo}/readme`);
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    return res.text();
  }
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (counterparts-directory-review)" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text|json|xml|markdown/.test(type)) throw new Error(`not text (${type})`);
  const body = await res.text();
  return /html/.test(type) ? plain(body) : body;
}

// One file per page: links to different sections of one page share it.
const pages = new Map();
for (const url of urls) {
  const page = url.split("#")[0];
  pages.set(page, [...(pages.get(page) ?? []), url]);
}
const index = [];
let n = 0;
for (const [page, links] of pages) {
  n++;
  const name = `sources/${String(n).padStart(2, "0")}.txt`;
  try {
    let body = await fetchSource(page);
    const cut = body.length > MAX_CHARS;
    if (cut) body = body.slice(0, MAX_CHARS);
    write(name, `${links.join("\n")}\n\n${body}${cut ? "\n\n[cut here: the source is longer]" : ""}`);
    index.push(`- ${name}${cut ? " (first part only)" : ""}: ${links.join(", ")}`);
  } catch (e) {
    index.push(`- not fetched (${e.message}): ${links.join(", ")}`);
  }
}
write("sources.md", `# Sources\n\n${index.join("\n")}\n`);
console.log(`sources: ${index.filter((l) => !l.startsWith("- not")).length} of ${pages.size} pages fetched`);
