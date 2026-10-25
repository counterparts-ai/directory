# The AI memory systems directory

This repo is the data behind **[counterparts.ai/directory](https://counterparts.ai/directory/)**:
a plain-language page for each AI memory system, saying what it's for, where your
memories live, and how it compares with the 11 ways human memory works.

Each system is one file in [`systems/`](systems/). Change the file, and the page changes.

**If you build one of these systems, this page is yours to correct.** You know your
system better than we do. Open a pull request and fix what's wrong, add what's new, or
add your system if it isn't here yet.

## Update your page

1. Open your file in [`systems/`](systems/) and click the pencil ("Edit this file").
2. Make your changes. GitHub will offer to open a pull request for you.
3. An automatic check tells you within a minute if anything is missing or mistyped.
4. A maintainer reads it and merges it. The live page updates a minute or two later.

## Add your system

1. Copy [`template.yaml`](template.yaml) to `systems/<your-slug>.yaml`.
2. Fill it in. [`systems/mem0.yaml`](systems/mem0.yaml) and
   [`systems/letta.yaml`](systems/letta.yaml) are good worked examples.
3. Open a pull request.

[CONTRIBUTING.md](CONTRIBUTING.md) has the details: what each field means, how to grade
the 11 mechanisms, and how to run the check on your own machine.

Rather not write YAML? [Open an issue](../../issues/new) saying what to add, with links
to its site and its code. Claude drafts the page from them as a pull request, and the
automatic review checks it like any other. To say what's wrong with a page, open an
issue too, and a maintainer makes the change.

## How the grades work

Every system is graded on the same 11 mechanisms, taken from
[The Memory Field Guide](https://counterparts.ai/ecosystem/). For each one a system is
**built**, **partly built**, **not built**, or (for closed products whose docs don't say)
**not known**, with a finer depth from 1 to 4. [`mechanisms.yaml`](mechanisms.yaml) says
what each mechanism means and where the bar sits for each step.

Two rules keep the grades honest:

- **Every "built" or "partly built" grade needs a link that shows it**: docs, code, or
  your own write-up. The check won't pass without one.
- **The bar is the same for everyone and written down here.** If you think a bar is
  wrong or unclear, open an issue or a pull request against `mechanisms.yaml`. That
  argument is welcome, and it happens in the open.

A page can also say what's **in development**, in your own words. Most pages don't have a
roadmap yet only because nobody has added one.

## How changes are reviewed

Nothing goes live until a maintainer merges it. The review checks three things:

- the file is complete (the automatic check covers this),
- each grade matches what its source link shows, by the bar in `mechanisms.yaml`,
- the wording stays plain and factual: no marketing, and no claims about other systems.

If a grade looks higher than its source supports, the reviewer will say so on the pull
request and ask for a better source or a lower grade. You can disagree there too.

When a pull request comes from someone who visibly belongs to the project (the repo's
owner, a member of its organisation, or a regular contributor), the page gets the
**"Confirmed by its makers"** mark.

## Who runs this

The directory is maintained by [Mike LaPeter](https://mikelapeter.com), who makes
[Counterparts](https://counterparts.ai), one of the systems listed. Counterparts is graded
by the same rules as everyone else, and its file is here to correct like any other:
[`systems/counterparts.yaml`](systems/counterparts.yaml).

## Licence

The entries and the rubric (`systems/`, `mechanisms.yaml`, `template.yaml` and these
documents) are under [CC BY 4.0](LICENSE): reuse them freely, with credit to "the
Counterparts directory" and a link back. The scripts and the schema (`scripts/`,
`schema/`, `.github/`) are under the [MIT licence](LICENSE-CODE). By opening a pull
request you agree to share your changes on the same terms.
