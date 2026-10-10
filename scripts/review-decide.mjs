#!/usr/bin/env node
/*
 * Turns the reviewer's verdict into a comment and a decision (.github/workflows/review.yml).
 *
 *   node scripts/review-decide.mjs --out review --maintainer <login>
 *
 * Reads review/gate.json and review/claude.json (the CLI's JSON output). Writes
 * review/comment.md, and prints `merge=true|false` for $GITHUB_OUTPUT. Code decides
 * the merge, not the reviewer: every grade supported, not spam, no prose to fix,
 * nothing flagged.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const OUT = resolve(value("--out"));
const MAINTAINER = value("--maintainer");
const read = (f) => (existsSync(join(OUT, f)) ? readFileSync(join(OUT, f), "utf8") : null);

const gate = JSON.parse(read("gate.json"));
const lines = [];
let merge = false;

if (!gate.eligible) {
  lines.push(`Thanks! This one ${gate.reason}, so it waits for a maintainer. @${MAINTAINER}`);
} else {
  let run = null;
  try {
    run = JSON.parse(read("claude.json") ?? "null");
  } catch {}
  const v = run?.structured_output;
  if (!v) {
    lines.push(`The automatic review didn't finish (${run?.subtype ?? "no output"}), so this waits for a maintainer. @${MAINTAINER}`);
  } else {
    const blocking = v.grades.filter((g) => !g.supported);
    const softer = v.grades.filter((g) => g.supported && g.suggested && g.suggested !== g.submitted);
    merge = !v.spam && blocking.length === 0 && v.prose_issues.length === 0 && v.concerns.length === 0;

    lines.push(v.summary.trim(), "");
    if (blocking.length) {
      lines.push("**Grades the sources don't support yet**", "");
      for (const g of blocking) lines.push(`- **${g.mechanism}**: ${g.submitted} → ${g.suggested}. ${g.reason}`);
      lines.push("");
    }
    if (v.prose_issues.length) {
      lines.push("**Wording**", "");
      for (const p of v.prose_issues) lines.push(`- ${p}`);
      lines.push("");
    }
    if (softer.length) {
      lines.push("**Not blocking**", "");
      for (const g of softer) lines.push(`- **${g.mechanism}**: ${g.submitted} holds; a case for ${g.suggested}. ${g.reason}`);
      lines.push("");
    }
    if (merge) {
      lines.push("Every grade checks out against its source, so this merges once the check passes, and the page goes live a minute or two later.");
      if (gate.isNew && v.maker_owns_repo) lines.push(`@${MAINTAINER}: the author looks like the maker, so this page needs its \`confirmed\` follow-up.`);
    } else if (v.spam) {
      lines.push(`This doesn't look like an AI memory system, so it waits for a maintainer. @${MAINTAINER}`);
    } else if (v.concerns.length) {
      lines.push(`A maintainer will take a look. @${MAINTAINER}`, "", ...v.concerns.map((c) => `- ${c}`));
    } else {
      lines.push("Push a change to this branch and it's reviewed again. If you think a grade is right as it stands, say why here and a maintainer will read it.");
    }

    lines.push("", "<details><summary>Every grade checked</summary>", "", "| mechanism | submitted | holds | source |", "| --- | --- | --- | --- |");
    for (const g of v.grades) lines.push(`| ${g.mechanism} | ${g.submitted} | ${g.supported ? "yes" : `no → ${g.suggested}`} | ${g.source_checked.replaceAll("|", "\\|")} |`);
    lines.push("", "</details>");
  }
}

lines.push("", "<sub>Automatic review: Claude read each linked source against the rubric in mechanisms.yaml.</sub>");

// The comment is public. Whatever the reviewer was talked into writing, no secret goes out.
let comment = lines.join("\n") + "\n";
for (const [k, v] of Object.entries(process.env)) if (k.startsWith("REDACT_") && v && v.length >= 8) comment = comment.replaceAll(v, "[redacted]");
comment = comment.replace(/\b(sk-ant-[\w-]+|gh[opsur]_[A-Za-z0-9]{20,}|github_pat_\w{20,})/g, "[redacted]");
writeFileSync(join(OUT, "comment.md"), comment);
console.log(`merge=${merge}`);
