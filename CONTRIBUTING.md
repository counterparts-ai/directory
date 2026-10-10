# Adding or updating a system

Thanks for helping keep the directory accurate. This page covers what goes in a file,
how to grade the 11 mechanisms, and how to check your change before you send it.

## The short version

- One system is one file: `systems/<slug>.yaml`. Start from [`template.yaml`](template.yaml).
- Write for a newcomer: plain words, short sentences. Say what it does, not how good it is.
- Every "built" or "partly built" grade needs a `source` link that shows it.
- Set `checked` to today's date.
- One system per pull request, please.

## What goes in a file

The template has a comment on every field. The parts people ask about most:

| Field | What to write |
| --- | --- |
| `tagline` | One plain line for the card. |
| `category` | Whose memory is it? `self` (the AI's own), `user` (memory about you), `work` (work & project memory), `blocks` (building blocks for developers). Use `alsoIn` for others it fits. |
| `openness` | `open`, `partly` or `closed`: how much of it people can read and run themselves. |
| `summary` | A short paragraph: what happens to a conversation, what's kept, how it comes back. |
| `doesnt` | What it doesn't do, said plainly. Every system has some, and readers trust a page more for it. |
| `standout` | Its most distinctive ideas. |
| `facts` | Where the memory lives, what someone has to set up, what it works with, license, price. |
| `hood` | The four things a developer compares first: who writes memories, where they're kept, how they're found, and what extra AI calls it makes. |
| `flow` | Optional: a left-to-right sketch of how it works, a few steps. |
| `sources` | The pages you checked it against. |

Stars and weekly downloads aren't in the file. They're fetched from GitHub, npm and PyPI
when the site builds, from the `links` you list.

## Grading the 11 mechanisms

[`mechanisms.yaml`](mechanisms.yaml) lists the mechanisms and the bar for each. Every
system gets one grade per mechanism:

| `status` | `depth` | Meaning |
| --- | --- | --- |
| `none` | (none) | It doesn't do this. |
| `partial` | `1` | A little: a side effect, a narrow case, or something you switch on or do yourself. |
| `partial` | `2` | Partly: a real piece of it, on purpose, with a clear part missing. |
| `built` | `3` | Built: it does what the mechanism's `built` line says. |
| `built` | `4` | Built in depth: it also meets the mechanism's `in-depth` line. |
| `unknown` | (none) | Only for closed products whose docs don't say. If the code is open, it's `none`. |

Each grade has a `note`: one plain sentence on what the system does here, or doesn't.

**`source`** is required for `built` and `partial`. Link to the page that shows it: a docs
page, a file in your repo, a release note, or your own write-up. A link to the exact
section is better than a link to a home page. If a feature isn't written up anywhere yet,
write it up first, then link to that.

**`only`** says when just one edition has it, for example `only: cloud only`.

**`dev`** is for what you're building now. It shows on the page as "in development" and as
a dashed outline on the chart:

```yaml
  prospective:
    status: none
    note: Nothing comes back on its own yet.
    dev:
      to: built
      note: "Coming: reminders that return on a date."
```

Grade what is released today. What's merged but not released goes in `dev`.

## Check it before you send it

The same check runs on every pull request, so this step is optional:

```sh
npm install
npm run check      # is every file complete and well-formed?
npm run links      # do the links load?
```

The check reads like this when something's off:

```
- systems/your-system.yaml: mechanisms.decay: a "built" grade needs a `source` link that shows it
```

## What happens next

An automatic review reads each source you linked and compares every grade with it, by
the bar in `mechanisms.yaml`, and posts what it found on your pull request. If every
grade holds, your pull request merges on its own and the live page updates a minute or
two later. If not, it says which grades need a better source or a lower depth; push a
change and it reviews again. You can push back right there too, and a maintainer will
read it.

Only a change to one system's file merges on its own: a new system, or an update to a
page whose maker you are. Anything else waits for a maintainer.

Please leave `confirmed` out of your file. The maintainers add it when they merge a pull
request from someone who visibly belongs to the project.

## Changing the rubric itself

If you think a mechanism's bar is wrong, unclear, or unfair to a kind of system, open an
issue or a pull request against [`mechanisms.yaml`](mechanisms.yaml). A change there
re-grades every system, so expect some discussion.
