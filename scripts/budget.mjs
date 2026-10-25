#!/usr/bin/env node
/*
 * Keeps the Claude runs within a daily allowance, so spam can't run up the bill
 * (.github/workflows/intake.yml and review.yml). It counts before Claude is started.
 *
 *   node scripts/budget.mjs --workflow intake.yml --max 6 [--author <login> --author-max 2]
 *                           [--pr <n> --pr-max 6] --gate <gate.json> --noun "automatic drafts"
 *
 * --max        runs of --workflow in the last 24 hours (this one not counted; runs that
 *              stopped before doing anything, a maintainer's own, are)
 * --author-max issues --author opened here in the last 24 hours, this one included
 * --pr-max     automatic reviews already posted on pull request --pr in the last 24 hours
 *
 * Within the allowance it exits 0 and changes nothing. Over it, it writes --gate as
 * { draft: false, eligible: false, reason } (what intake-finish.mjs and review-decide.mjs
 * read: "This issue <reason>" / "This pull request <reason>") and exits 1.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { api } from "./sources.mjs";

const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const REPO = process.env.GITHUB_REPOSITORY;
const RUN = Number(process.env.GITHUB_RUN_ID);
const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const json = async (path) => {
  const res = await api(path, "application/vnd.github+json");
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
};

async function over() {
  const max = Number(value("--max"));
  if (max >= 0) {
    const runs = await json(`/repos/${REPO}/actions/workflows/${value("--workflow")}/runs?created=${encodeURIComponent(`>=${since}`)}&per_page=100`);
    // Skipped runs did nothing (a maintainer's own); every other run counts, finished or not.
    const n = runs.workflow_runs.filter((r) => r.id !== RUN && r.conclusion !== "skipped").length;
    if (n >= max) return `arrived after today's limit of ${max} ${value("--noun")}`;
  }
  const author = value("--author");
  const authorMax = Number(value("--author-max"));
  if (author && authorMax >= 0) {
    const q = `repo:${REPO} is:issue author:${author} created:>=${since}`;
    const n = (await json(`/search/issues?q=${encodeURIComponent(q)}&per_page=1`)).total_count;
    if (n > authorMax) return `is past the limit of ${authorMax} a day from one person`;
  }
  const pr = value("--pr");
  const prMax = Number(value("--pr-max"));
  if (pr && prMax >= 0) {
    const comments = await json(`/repos/${REPO}/issues/${pr}/comments?since=${encodeURIComponent(since)}&per_page=100`);
    const n = comments.filter((c) => c.body?.startsWith("<!-- directory-review -->")).length;
    if (n >= prMax) return `has had ${n} automatic reviews today, the limit for one pull request`;
  }
  return null;
}

let reason;
try {
  reason = await over();
} catch (e) {
  // If it can't count, it doesn't spend.
  reason = `couldn't be checked against today's limits (${e.message})`;
}
if (!reason) process.exit(0);
const gate = resolve(value("--gate"));
mkdirSync(dirname(gate), { recursive: true });
writeFileSync(gate, JSON.stringify({ draft: false, eligible: false, reason }, null, 2));
console.log(`budget: ${reason}`);
process.exit(1);
