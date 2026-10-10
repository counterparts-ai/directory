# Maintaining the directory

How a change gets from a pull request to the live site, for whoever holds the merge button.

## Reviewing a pull request

1. **Let the check run.** GitHub holds the check for a first-time contributor until a
   maintainer clicks "Approve and run". Read the diff first: the check runs main's copy of
   the checker, but it's still their change.
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
