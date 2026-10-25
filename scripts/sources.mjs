/*
 * Fetching a source page as plain text, for the automatic review (review-prep.mjs) and
 * the issue intake (intake-prep.mjs). GitHub files and READMEs go through the API
 * (authenticated with GITHUB_TOKEN when it's set, so not throttled); anything else is
 * fetched as a web page and reduced to its text.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TOKEN = process.env.GITHUB_TOKEN;
const MAX_CHARS = 60_000; // per source: enough for a docs page or a source file
const MAX_PAGES = 25; // sources fetched per run
const MAX_TOTAL = 500_000; // across all of them

// No "." or ".." segments: they would turn into other API endpoints.
const segment = (p) => /^[\w.-]+$/.test(p) && !/^\.+$/.test(p);
export function githubFile(url) {
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|tree)\/([^/]+)\/([^#?]+)/);
  if (!m || ![m[1], m[2], ...m[4].split("/")].every(segment)) return null;
  return { owner: m[1], repo: m[2], ref: m[3], path: m[4] };
}
export function githubRepo(url) {
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)\/?(?:[#?].*)?$/);
  return m && segment(m[1]) && segment(m[2]) ? { owner: m[1], repo: m[2] } : null;
}
export const api = (path, accept = "application/vnd.github.raw+json") =>
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

export async function fetchSource(url) {
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

/**
 * Fetches each link into <out>/sources/NN.txt, one file per page (links to different
 * sections of one page share it), with the links to it on the first lines. Returns the
 * index lines for sources.md, the links that couldn't be fetched, and the page count.
 */
export async function fetchSources(urls, out) {
  mkdirSync(join(out, "sources"), { recursive: true });
  const write = (file, text) => writeFileSync(join(out, file), text);
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
      if (n > MAX_PAGES || total >= MAX_TOTAL) throw new Error("over the limit on sources");
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
  return { index, unfetched, pages: pages.size };
}
