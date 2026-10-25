#!/usr/bin/env node
/*
 * Turns the drafter's answer into a page, checks it, and says what happens next
 * (.github/workflows/intake.yml).
 *
 *   node scripts/intake-finish.mjs --out intake --base base --next next --issue <n> --author <login> --maintainer <login> [--last]
 *
 * Reads intake/claude.json (the CLI's JSON output). A draft is written to
 * next/systems/<slug>.yaml, with `checked` set to today and `confirmed` taken out, and
 * run through main's check. Prints `ok=true|false` for $GITHUB_OUTPUT: false means the
 * check failed and intake/check.txt says why, so the drafter can fix it. With --last
 * there's no further try, and a page that still fails goes to a maintainer.
 *
 * Writes intake/decision.json { open, review, slug, name }; intake/draft.yaml, the page
 * as checked; intake/pr.md when a pull request should open; and intake/comment.md for
 * the issue, where {PR} stands for the pull request's number.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { clean, redact } from "./public.mjs";

const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const OUT = resolve(value("--out"));
const BASE = resolve(value("--base"));
const NEXT = resolve(value("--next"));
const ISSUE = value("--issue");
const AUTHOR = value("--author");
const MAINTAINER = value("--maintainer");
const LAST = args.includes("--last");
const read = (f) => (existsSync(join(OUT, f)) ? readFileSync(join(OUT, f), "utf8") : null);
const write = (f, text) => writeFileSync(join(OUT, f), text);
const repo = JSON.parse(read("repo.json") ?? "null");
const footer = "\n<sub>Automatic intake: Claude drafted this from the issue's links and the code, against the rubric in mechanisms.yaml.</sub>\n";

function finish(decision, comment, pr) {
  write("decision.json", JSON.stringify(decision, null, 2));
  write("comment.md", redact(comment + (decision.open ? footer : "\n<sub>Automatic intake.</sub>\n")));
  if (pr) write("pr.md", redact(pr + footer));
  console.log(`ok=true`);
  process.exit(0);
}
const toMaintainer = (why) =>
  finish({ open: false }, `Thanks for this, @${AUTHOR}! ${why} A maintainer will take it from here. @${MAINTAINER}\n`);

const gate = JSON.parse(read("gate.json") ?? '{"draft":false,"reason":"couldn\'t be read by the intake"}');
if (!gate.draft) toMaintainer(`This issue ${gate.reason}, so it needs a person rather than a drafted page.`);

let run = null;
try {
  run = JSON.parse(read("claude.json") ?? "null");
} catch {}
const v = run?.structured_output;
if (!v) toMaintainer(`The automatic draft didn't finish (${clean(run?.subtype ?? "no output", 80)}).`);
if (v.action !== "draft") toMaintainer(`It doesn't look like a request for a new page (${clean(v.reason, 300) || "no reason given"}).`);

const slug = String(v.slug);
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) toMaintainer("The drafted page didn't come with a usable slug.");
if (existsSync(join(BASE, "systems", `${slug}.yaml`))) toMaintainer(`A page called \`${slug}\` is already listed.`);

/* ── the page: today's date, no `confirmed`, the slug it's filed under ── */
const doc = YAML.parseDocument(String(v.yaml));
let problems = doc.errors.map((e) => e.message);
if (!problems.length) {
  if (!doc.contents || !YAML.isMap(doc.contents)) problems.push("the file isn't a YAML mapping");
  else {
    if (doc.get("slug") !== slug) problems.push(`the file's slug is ${JSON.stringify(doc.get("slug"))}, not ${JSON.stringify(slug)}`);
    doc.delete("confirmed");
    doc.set("checked", new Date().toISOString().slice(0, 10));
  }
}
const file = join(NEXT, "systems", `${slug}.yaml`);
// Only this page is new: a first try under another slug is cleared away.
for (const f of readdirSync(join(NEXT, "systems"))) if (!existsSync(join(BASE, "systems", f))) unlinkSync(join(NEXT, "systems", f));
if (!problems.length) {
  writeFileSync(file, doc.toString({ lineWidth: 0 }));
  write("draft.yaml", doc.toString({ lineWidth: 0 }));
  // main's check, as a pull request gets it: the page, then its links.
  for (const extra of [[], ["--links"]]) {
    const r = spawnSync("node", [join(BASE, "scripts/check.mjs"), "--data", NEXT, "--base", BASE, ...extra], { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } });
    if (r.status !== 0) {
      problems.push((r.stdout + r.stderr).trim());
      break;
    }
  }
}
if (problems.length) {
  write("check.txt", problems.join("\n"));
  console.error(problems.join("\n"));
  if (!LAST) {
    console.log("ok=false");
    process.exit(0);
  }
  toMaintainer("The drafted page didn't pass the check after a second try.");
}

/* ── a pull request, and whether the automatic review gets it ── */
const name = clean(doc.get("name"), 80);
const list = (x) => (Array.isArray(x) ? x : []).map((c) => clean(c)).filter(Boolean);
const concerns = list(v.concerns);
const notes = list(v.notes);
const against = repo ? ` and the code of ${clean(repo.owner, 60)}/${clean(repo.name, 100)} at \`${clean(repo.ref, 100).replaceAll("`", "")}\`` : "";
const pr = [
  `Drafted from #${ISSUE}, opened by @${AUTHOR}, from the pages it links${against}.`,
  "",
  clean(v.summary, 1500),
  "",
  ...(concerns.length
    ? ["**For a maintainer** (so the automatic review doesn't run):", "", ...concerns.map((c) => `- ${c}`), "", `@${MAINTAINER}`]
    : ["The automatic review checks each grade against its source next. If they all hold, this merges and the page goes live."]),
  ...(notes.length ? ["", "<details><summary>Notes from the draft</summary>", "", ...notes.map((n) => `- ${n}`), "", "</details>"] : []),
  "",
  `If @${AUTHOR} makes ${name}, a maintainer adds \`confirmed\` after it merges.`,
  "",
  `Closes #${ISSUE}`,
].join("\n");
const comment = [
  `Thanks, @${AUTHOR}! I've drafted ${name}'s page from your links${against}: #{PR}.`,
  "",
  clean(v.summary, 1500),
  "",
  concerns.length
    ? `A maintainer will look at it before it goes further. @${MAINTAINER}`
    : `An automatic review now checks each grade against its source; if they all hold, it merges and the page goes live a minute or two later. Anything wrong? Say so on the pull request. @${MAINTAINER}`,
].join("\n");
finish({ open: true, review: concerns.length === 0, slug, name }, comment + "\n", pr + "\n");
