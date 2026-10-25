#!/usr/bin/env node
/*
 * Gets an issue ready for the intake (.github/workflows/intake.yml), which drafts a new
 * system's page from an issue that asks for one.
 *
 *   node scripts/intake-prep.mjs --issue issue.json --base . --out intake
 *
 * Everything in the issue is the author's: its links are fetched and its repo is cloned
 * to be read, never installed or run.
 *
 * Writes into --out:
 *   gate.json      { draft, reason, repo }: draft is false when it needs a person instead
 *   issue.md       the issue as its author wrote it
 *   sources/NN.txt each page the issue links, with the links to it on the first lines
 *   sources.md     the index of what was fetched, and what couldn't be
 *   repo.json      { owner, name, ref, kind, license }: the repo cloned into repo/, and at what
 *   repo/          the repo's files at its latest release (no symlinks, no .git, no
 *                  CLAUDE.md or .claude/)
 *   repo-files.txt every file in repo/
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { api, fetchSources } from "./sources.mjs";

const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const issue = JSON.parse(readFileSync(resolve(value("--issue")), "utf8"));
const BASE = resolve(value("--base"));
const OUT = resolve(value("--out"));
const MAX_LINKS = 15; // links taken from one issue
const MAX_FILE = 1_000_000; // a cloned file bigger than this isn't kept
const MAX_LISTED = 20_000; // files named in repo-files.txt

mkdirSync(OUT, { recursive: true });
const write = (file, text) => writeFileSync(join(OUT, file), text);
const done = (gate) => {
  write("gate.json", JSON.stringify(gate, null, 2));
  console.log(`gate: ${gate.draft ? "draft" : "for a maintainer"}: ${gate.reason}`);
  process.exit(0);
};

const title = String(issue.title ?? "");
const text = `${title}\n${issue.body ?? ""}`;
write("issue.md", `# ${title}\n\nOpened by ${issue.user?.login} on ${issue.created_at}.\n\n${issue.body ?? ""}\n`);

const parses = (u) => URL.canParse(u);
const links = [...new Set((text.match(/https:\/\/[^\s<>()"'`\]]+/g) ?? []).map((u) => u.replace(/[.,;:!?*_]+$/, "")).filter(parses))].slice(0, MAX_LINKS);
if (!links.length) done({ draft: false, reason: "has no links to draft a page from" });

/* ── a system already listed: a correction, which a maintainer makes ── */
const norm = (s) => String(s ?? "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[\/\s]+$/, "");
const repoOf = (url) => url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)/)?.slice(1, 3).map((s) => s.replace(/\.git$/, ""));
const mentioned = new Set(links.flatMap((u) => [norm(u), norm(new URL(u).host), ...(repoOf(u) ? [repoOf(u).join("/").toLowerCase(), `github.com/${repoOf(u).join("/").toLowerCase()}`] : [])]));
for (const f of readdirSync(join(BASE, "systems")).filter((f) => f.endsWith(".yaml"))) {
  const s = YAML.parse(readFileSync(join(BASE, "systems", f), "utf8"));
  const theirs = [s.links?.website, ...(s.links?.repos ?? [])].filter((x) => typeof x === "string").map(norm);
  if (theirs.some((t) => mentioned.has(t))) done({ draft: false, reason: `is about ${s.name}, which is already listed` });
}

/* ── the repo to read: the GitHub repo the issue links most ── */
const counts = new Map();
for (const r of links.map(repoOf).filter(Boolean)) counts.set(r.join("/"), (counts.get(r.join("/")) ?? 0) + 1);
const top = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
let repo = null;
// A repo that can't be read or cloned leaves the pages alone to draft from.
if (top) try {
  const [owner, name] = top.split("/");
  const info = await api(`/repos/${owner}/${name}`, "application/vnd.github+json");
  if (info.ok) {
    const meta = await info.json();
    const release = await api(`/repos/${owner}/${name}/releases/latest`, "application/vnd.github+json");
    // The latest release when there is one, since a page grades what's released; else the
    // default branch as it is now. The ref goes into public text, so only a plain tag name counts.
    const tag = release.ok ? (await release.json()).tag_name : null;
    const kind = typeof tag === "string" && /^\w[\w.\/-]{0,99}$/.test(tag) ? "release" : "commit";
    let ref = kind === "release" ? tag : null;
    const dir = join(OUT, "repo");
    execFileSync("git", ["-c", "advice.detachedHead=false", "clone", "--quiet", "--depth", "1", ...(kind === "release" ? ["--branch", ref] : []), `https://github.com/${owner}/${name}.git`, dir], { stdio: "inherit" });
    if (kind === "commit") ref = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    // Read with the reviewer's tools, a symlink could lead anywhere on the runner; and nothing here is run.
    execFileSync("rm", ["-rf", join(dir, ".git")]);
    execFileSync("find", [dir, "-type", "l", "-delete"]);
    execFileSync("find", [dir, "-type", "f", "-size", `+${MAX_FILE}c`, "-delete"]);
    // Claude Code reads a folder's CLAUDE.md and .claude/ as instructions; here they're only the repo's.
    execFileSync("find", [dir, "(", "-name", "CLAUDE.md", "-o", "-name", "CLAUDE.local.md", ")", "-type", "f", "-delete"]);
    execFileSync("find", [dir, "-name", ".claude", "-type", "d", "-prune", "-exec", "rm", "-rf", "{}", "+"]);
    const files = execFileSync("find", [".", "-type", "f"], { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean).map((f) => f.slice(2)).sort();
    write("repo-files.txt", `${files.slice(0, MAX_LISTED).join("\n")}\n${files.length > MAX_LISTED ? `[and ${files.length - MAX_LISTED} more]\n` : ""}`);
    repo = { owner: meta.owner.login, name: meta.name, ref, kind, license: meta.license?.spdx_id ?? null };
    write("repo.json", JSON.stringify(repo, null, 2));
  }
} catch (e) {
  console.log(`repo: couldn't clone ${top} (${e.message})`);
  repo = null;
  execFileSync("rm", ["-rf", join(OUT, "repo"), join(OUT, "repo.json"), join(OUT, "repo-files.txt")]);
}

const { index, unfetched } = await fetchSources(links, OUT);
write("sources.md", `# Sources\n\n${index.join("\n")}\n`);
console.log(`sources: ${index.filter((l) => !l.startsWith("- not")).length} of ${links.length} links fetched (by page); repo: ${repo ? `${repo.owner}/${repo.name} at ${repo.ref}` : "none"}`);
if (!repo && unfetched.length === links.length) done({ draft: false, reason: "links to nothing the intake could read" });
done({ draft: true, reason: "asks for a new system", repo: repo ? `${repo.owner}/${repo.name}@${repo.ref}` : null });
