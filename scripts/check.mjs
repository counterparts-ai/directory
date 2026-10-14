#!/usr/bin/env node
/*
 * The check every pull request runs.
 *
 *   node scripts/check.mjs                  every file in systems/ is complete and well-formed
 *   node scripts/check.mjs --links          …and the links in them load
 *
 * On a pull request the workflow runs this copy (from main) against the pull
 * request's files, with main's files to compare against:
 *
 *   --data <dir>    the files to check (default: this repo)
 *   --base <dir>    the files they change; limits --links to what changed, and
 *                   reports what the pull request touches
 *   --maintainer    the author maintains the directory, so may set `confirmed`
 *
 * Problems fail the check. Notes don't: they tell the reviewer what to look at.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import YAML from "yaml";

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const DATA = resolve(value("--data") ?? HERE);
const BASE = value("--base") ? resolve(value("--base")) : null;

const problems = [];
const notes = [];
const problem = (file, text) => problems.push({ file, text });
const note = (text) => notes.push(text);

const read = (dir, file) => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8") : null);
const systemFiles = (dir) =>
  existsSync(join(dir, "systems"))
    ? readdirSync(join(dir, "systems"))
        .filter((f) => f.endsWith(".yaml"))
        .sort()
        .map((f) => `systems/${f}`)
    : [];

/* ── the rules: the schema, and the mechanism list it has to agree with ── */
const schema = JSON.parse(read(DATA, "schema/system.schema.json"));
const mechanismIds = YAML.parse(read(DATA, "mechanisms.yaml")).map((m) => m.id);
const schemaIds = Object.keys(schema.properties.mechanisms.properties);
if (mechanismIds.join() !== schemaIds.join())
  problem("schema/system.schema.json", `lists different mechanisms from mechanisms.yaml (${schemaIds.join(", ")})`);
const validate = new Ajv({ allErrors: true }).compile(schema);

/** A schema error, said the way someone filling in a file would want to hear it. */
function say(e, entry) {
  const at = e.instancePath.slice(1).replaceAll("/", ".");
  const where = at ? `${at}: ` : "";
  const rating = /^mechanisms\.[a-z-]+$/.test(at) ? entry.mechanisms?.[at.split(".")[1]] : null;
  if (e.keyword === "required" && rating && e.params.missingProperty === "source")
    return `${where}a "${rating.status}" grade needs a \`source\` link that shows it (docs, code, or your own write-up)`;
  if (e.keyword === "required" && rating && e.params.missingProperty === "depth")
    return `${where}a "${rating.status}" grade needs a \`depth\` (${rating.status === "built" ? "3 or 4" : "1 or 2"}; see mechanisms.yaml)`;
  if (e.keyword === "required") return `${where}\`${e.params.missingProperty}\` is missing`;
  if (e.keyword === "additionalProperties") return `${where}\`${e.params.additionalProperty}\` isn't a field (a typo?)`;
  if (e.keyword === "enum" && /\.depth$/.test(at)) {
    const r = entry.mechanisms?.[at.split(".")[1]];
    return `${where}${JSON.stringify(r?.depth)} doesn't go with "${r?.status}" (partial is 1 or 2, built is 3 or 4)`;
  }
  if (e.keyword === "enum") return `${where}must be one of ${e.params.allowedValues.join(", ")}`;
  if (e.keyword === "not" && rating) return `${where}a "${rating.status}" grade has no \`depth\``;
  if (e.keyword === "pattern" && e.params.pattern.startsWith("^https")) return `${where}must be a full https:// link`;
  if (e.keyword === "pattern") return `${where}isn't in the expected form (${e.params.pattern})`;
  if (e.keyword === "if") return null; // the `then` error beside it says what's wrong
  return `${where}${e.message}`;
}

/* ── every system file ── */
const entries = new Map(); // file → parsed entry
for (const file of systemFiles(DATA)) {
  // A symlink would be followed by whatever reads this repo; only ordinary files.
  if (!lstatSync(join(DATA, file)).isFile()) {
    problem(file, "has to be an ordinary file, not a link");
    continue;
  }
  let entry;
  try {
    entry = YAML.parse(read(DATA, file));
  } catch (err) {
    problem(file, `isn't valid YAML: ${err.message.split("\n")[0]}`);
    continue;
  }
  if (!entry || typeof entry !== "object") {
    problem(file, "is empty");
    continue;
  }
  entries.set(file, entry);
  if (!validate(entry)) for (const text of new Set(validate.errors.map((e) => say(e, entry)).filter(Boolean))) problem(file, text);
  if (entry.slug && file !== `systems/${entry.slug}.yaml`) problem(file, `\`slug\` is "${entry.slug}", so the file should be systems/${entry.slug}.yaml`);
  const steps = entry.flow?.steps?.length;
  if (steps && entry.flow.loop && entry.flow.loop.to >= steps) problem(file, `flow.loop.to points past the last step (steps are counted from 0)`);
}
if (!entries.size && !problems.length) problem("systems/", "no system files found");

/* ── what a pull request changes ── */
const changed = new Set(); // system files that are new or different from the base
if (BASE) {
  const before = new Set(systemFiles(BASE));
  for (const file of new Set([...before, ...systemFiles(DATA)])) {
    const was = read(BASE, file);
    const now = read(DATA, file);
    if (was === now) continue;
    if (now === null) {
      note(`Removes ${file}.`);
      continue;
    }
    changed.add(file);
    const entry = entries.get(file);
    if (was === null) note(`New system: ${entry?.name ?? file}.`);
    let old;
    try {
      old = was === null ? undefined : YAML.parse(was);
    } catch {}
    if (entry && JSON.stringify(entry.confirmed ?? null) !== JSON.stringify(old?.confirmed ?? null) && !flag("--maintainer"))
      problem(file, "`confirmed` is set by the directory's maintainers when they merge; please leave it as it was");
  }
  if (changed.size > 1) note(`Touches ${changed.size} systems: ${[...changed].join(", ")}.`);
  for (const file of ["mechanisms.yaml", "schema/system.schema.json", "scripts/check.mjs", "template.yaml"])
    if (read(BASE, file) !== read(DATA, file)) note(`Changes ${file}, which every entry depends on.`);
}

/* ── links: only a link that is plainly gone fails; a site that turns robots away is a note ── */
if (flag("--links") && !problems.length) {
  const files = BASE ? [...changed] : [...entries.keys()];
  const urls = new Map(); // url → the files that use it
  for (const file of files) {
    const e = entries.get(file);
    const all = [e.links.website, ...e.sources.map((s) => s.url), ...Object.values(e.mechanisms).map((m) => m.source)];
    for (const url of all.filter(Boolean)) urls.set(url, [...(urls.get(url) ?? []), file]);
  }
  const fetchStatus = async (url) => {
    const headers = { "user-agent": "counterparts-directory-check (+https://counterparts.ai/directory/)" };
    // GitHub's API answers where its pages rate-limit; the workflow passes a token
    if (process.env.GITHUB_TOKEN && /^https:\/\/api\.github\.com\//.test(url)) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    try {
      const r = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(20000) });
      return r.status;
    } catch (err) {
      return err.cause?.code === "ENOTFOUND" ? "no such site" : "no answer";
    }
  };
  const queue = [...urls.keys()];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let url = queue.pop(); url; url = queue.pop()) {
        const status = await fetchStatus(url);
        if (status === 404 || status === 410 || status === "no such site") for (const f of new Set(urls.get(url))) problem(f, `this link doesn't load (${status}): ${url}`);
        else if (status !== 200) note(`Couldn't confirm ${url} (${status}); worth opening by hand.`);
      }
    }),
  );
  console.log(`Checked ${urls.size} links in ${files.length} file${files.length === 1 ? "" : "s"}.`);
}

/* ── the report ── */
const lines = [];
if (problems.length) {
  lines.push(`${problems.length} problem${problems.length === 1 ? "" : "s"} to fix:`, "");
  for (const p of problems) lines.push(`- ${p.file}: ${p.text}`);
} else lines.push(`All good: ${entries.size} system${entries.size === 1 ? "" : "s"} checked.`);
if (notes.length) lines.push("", "For the reviewer:", "", ...[...new Set(notes)].map((n) => `- ${n}`));
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n\n");
if (process.env.GITHUB_ACTIONS) for (const p of problems) console.log(`::error file=${p.file}::${p.text}`);
process.exit(problems.length ? 1 : 0);
