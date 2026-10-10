# Maintaining the directory

How a change gets from a pull request to the live site, for whoever holds the merge button.

## The automatic review

`.github/workflows/review.yml` reviews each pull request from a contributor. It merges on
its own only when all of these hold; otherwise it comments and @mentions a maintainer:

- the pull request changes exactly one file, `systems/<slug>.yaml`: a new system, or an
  update from that page's confirmed maker (rubric, schema, scripts and workflows never
  merge on their own)
- Claude, reading each linked source (fetched beforehand, with no web or shell of its
  own), finds every grade supported, no wording to fix, nothing that needs a person, and
  nothing that looks like spam
- the check passes

It runs on `pull_request_target`, so it uses main's scripts and only reads the pull
request's files. `AUTO_MERGE` at the top of the workflow turns merging off (it still
comments). It needs the `CLAUDE_CODE_OAUTH_TOKEN` secret (from `claude setup-token`). To
review one pull request by hand, run the workflow from the Actions tab with its number;
"dry run" puts the review in the run's summary instead of on the pull request.

A merge it makes doesn't start other workflows, so it asks the site to rebuild itself.
The `confirmed` mark is still yours: when the review says the author looks like the
maker, add it in your own pull request (step 5 below).

## Reviewing a pull request by hand

1. **Let the check run.** Read the diff first: the check runs main's copy of the
   checker, but it's still their change.
2. **Read the check's summary.** "For the reviewer" lists what the pull request touches:
   a new system, more than one system, or the rubric, schema or checker.
3. **Compare each changed grade with its source**, by the bar in `mechanisms.yaml`. Open
   the link. Does it show what the note says? Is the depth what the bar allows? Grade one
   mechanism the same way for every system.
4. **Read the prose** for plain, factual wording: no marketing, no claims about other
   systems.
5. **Decide whether it's from the makers.** The author owns the listed repo, is a public
   member of its organisation, or is a regular contributor to it. If so, add `confirmed` in
   your own pull request right after merging theirs (the check fails a contributor's pull
   request that sets it, even when a maintainer pushed the change):

   ```yaml
   confirmed:
     by: their-github-handle
     on: 2026-10-01
   ```

6. **Merge.** The "Rebuild counterparts.ai" workflow asks the site to rebuild; the page is
   live a minute or two later.

If a grade is higher than its source supports, say so on the pull request and ask for a
better source or a lower grade. Disagreements stay on the pull request, in the open.

## How the site uses this repo

counterparts.ai reads `systems/*.yaml` and `mechanisms.yaml` from `main` each time it
builds. A merge here triggers a build through a deploy hook (the `SITE_DEPLOY_HOOK`
secret). If a build can't read this repo, it fails and the last good version stays live.

## Changing the format

A new field means three edits: `schema/system.schema.json` and `template.yaml` here, and
the site's own types, which decide what a page shows. A field the site doesn't know is
ignored, so add it to the site first.
