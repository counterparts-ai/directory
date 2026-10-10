#!/usr/bin/env node
/*
 * Turns the reviewer's verdict into a comment and a decision (.github/workflows/review.yml).
 *
 *   node scripts/review-decide.mjs --out review --maintainer <login>
 *
 * Reads review/gate.json, review/review.json and review/claude.json (the CLI's JSON
 * output). Writes review/comment.md, and prints `merge=true|false` for $GITHUB_OUTPUT.
 * Code decides the merge, not the reviewer: every grade that needed reviewing was
 * reviewed against a fetched source and holds, nothing reads as spam, no wording to
 * fix, nothing flagged for a person.
 *
 * AUTO_MERGE and DRY_RUN (from the environment) only change what the comment promises.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const OUT = resolve(value("--out"));
const MAINTAINER = value("--maintainer");
const WILL_MERGE = process.env.AUTO_MERGE === "true" && process.env.DRY_RUN !== "true";
const read = (f) => (existsSync(join(OUT, f)) ? readFileSync(join(OUT, f), "utf8") : null);

/** Model text in a public comment: one line, no table breaks, no @mentions, no images. */
const clean = (s, max = 600) =>
  String(s ?? "").replace(/\s+/g, " ").replaceAll("|", "\\|").replace(/@(?=\w)/g, "@\u200b").replace(/!\[/g, "[").slice(0, max).trim();

const gate = JSON.parse(read("gate.json"));
const lines = ["<!-- directory-review -->"];
let merge = false;

if (!gate.eligible) {
  lines.push(`Thanks! This pull request ${gate.reason}, so it waits for a maintainer. @${MAINTAINER}`);
} else {
  const must = JSON.parse(read("review.json"));
  let run = null;
  try {
    run = JSON.parse(read("claude.json") ?? "null");
  } catch {}
  const v = run?.structured_output;
  if (!v) {
    lines.push(`The automatic review didn't finish (${clean(run?.subtype ?? "no output", 80)}), so this waits for a maintainer. @${MAINTAINER}`);
  } else {
    const reviewed = new Set(v.grades.map((g) => g.mechanism));
    const missing = must.mechanisms.filter((id) => !reviewed.has(id));
    const blocking = v.grades.filter((g) => !g.supported);
    const softer = v.grades.filter((g) => g.supported && g.suggested && g.suggested !== g.submitted);
    const noGrades = gate.isNew && must.mechanisms.length === 0; // a new system with nothing graded needs a person
    merge = !v.spam && !noGrades && blocking.length === 0 && missing.length === 0 && must.unfetched.length === 0 && v.prose_issues.length === 0 && v.concerns.length === 0;

    lines.push(clean(v.summary, 1500), "");
    if (blocking.length) {
      lines.push("**Grades the sources don't support yet**", "");
      for (const g of blocking) lines.push(`- **${clean(g.mechanism, 40)}**: ${clean(g.submitted, 20)} → ${clean(g.suggested, 20)}. ${clean(g.reason)}`);
      lines.push("");
    }
    if (must.unfetched.length) {
      lines.push(`**Sources that couldn't be read:** ${must.unfetched.map((id) => `\`${id}\``).join(", ")}. A maintainer will open them by hand.`, "");
    }
    if (v.prose_issues.length) {
      lines.push("**Wording**", "");
      for (const p of v.prose_issues) lines.push(`- ${clean(p)}`);
      lines.push("");
    }
    if (softer.length) {
      lines.push("**Not blocking**", "");
      for (const g of softer) lines.push(`- **${clean(g.mechanism, 40)}**: ${clean(g.submitted, 20)} holds; a case for ${clean(g.suggested, 20)}. ${clean(g.reason)}`);
      lines.push("");
    }
    if (merge) {
      lines.push(
        WILL_MERGE
          ? "Every grade checks out against its source, so this merges once the check passes, and the page goes live a minute or two later."
          : `Every grade checks out against its source. A maintainer will merge it. @${MAINTAINER}`,
      );
      if (gate.isNew && v.maker_owns_repo) lines.push(`@${MAINTAINER}: the author looks like the maker, so this page needs its \`confirmed\` follow-up.`);
    } else if (v.spam) {
      lines.push(`This doesn't look like an AI memory system, so it waits for a maintainer. @${MAINTAINER}`);
    } else if (missing.length || must.unfetched.length || v.concerns.length || noGrades) {
      lines.push(`A maintainer will take a look. @${MAINTAINER}`);
      if (missing.length) lines.push("", `- The review skipped: ${missing.map((id) => `\`${id}\``).join(", ")}.`);
      for (const c of v.concerns) lines.push(`- ${clean(c)}`);
    } else {
      lines.push("Push a change to this branch and it's reviewed again. If you think a grade is right as it stands, say why here and a maintainer will read it.");
    }

    lines.push("", "<details><summary>Every grade checked</summary>", "", "| mechanism | submitted | holds | source |", "| --- | --- | --- | --- |");
    for (const g of v.grades)
      lines.push(`| ${clean(g.mechanism, 40)} | ${clean(g.submitted, 20)} | ${g.supported ? "yes" : `no → ${clean(g.suggested, 20)}`} | ${clean(g.source_checked, 300)} |`);
    lines.push("", "</details>");
  }
}

lines.push("", "<sub>Automatic review: Claude read each linked source against the rubric in mechanisms.yaml.</sub>");

// The comment is public. Whatever the reviewer was talked into writing, no secret goes out.
let comment = lines.join("\n") + "\n";
for (const [k, v] of Object.entries(process.env)) if (k.startsWith("REDACT_") && v && v.length >= 8) comment = comment.replaceAll(v, "[redacted]");
comment = comment.replace(/\b(sk-ant-[\w-]+|gh[opsur]_[A-Za-z0-9]{20,}|github_pat_\w{20,})/g, "[redacted]");
writeFileSync(join(OUT, "comment.md"), comment.slice(0, 60_000));
console.log(`merge=${merge}`);
