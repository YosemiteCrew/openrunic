# Traffic history

How openrunic's clone and view counts are collected, and what they do and do not mean.

## Why this exists

GitHub's traffic API serves a rolling **14-day window** and discards everything older. There is no
setting that extends it and no export that recovers it. So the Insights graphs cannot answer "how
many times has this been cloned since we opened it", and neither can the API: by the time the
question is asked, the answer has been deleted.

`.github/workflows/traffic.yml` runs daily, takes a snapshot of the window, and folds it into a
permanent history on an orphaned data branch. The README carried badges reading from that history
until the 0.1.0 release; they were removed because the job had never once succeeded, so the only
thing they ever published was four zeros. The history itself is still worth keeping, because it is
the only record that survives the rolling window.

## Why the totals are not simply added up

Consecutive snapshots overlap by thirteen days. Adding one day's response to the next would roughly
double every figure, and the error would compound daily until the numbers were meaningless.

So the history is a map from **date** to that day's counts, and folding a snapshot writes each of its
days into that map. A date that is already present is **overwritten, not incremented**. The newer
snapshot is at worst identical and at best more complete, because GitHub is still counting the
current day at the moment the earlier snapshot is taken.

`.github/scripts/fold-traffic.mjs` is where that happens, and it is the only place the arithmetic
lives.

## What the numbers mean

**Total** is the sum of the per-day counts, and it is honest as far back as `First recorded` on the
generated summary, which is the day the job first ran, not the day of the first commit. Everything
before that is gone. The summary prints the start date rather than implying otherwise, because a
figure that overstates its own coverage is worse than one that admits where it begins.

**Daily-unique** is the sum of GitHub's per-day unique counts. It is deliberately **not** labelled
"unique visitors", because it is not the number of distinct people over the period: somebody who
clones on Monday and again on Friday is counted as unique on both days. GitHub's own 14-day figure
deduplicates across its window, so the two numbers answer different questions and cannot be compared
directly.

## Where it lives

Everything is written to the **`traffic-data`** branch:

```text
history/clones.json    date -> { count, uniques }
history/views.json     date -> { count, uniques }
badges/*.json          shields.io endpoint payloads the README points at
README.md              a generated summary table
```

That branch is orphaned and carries no application code, so it cannot be mistaken for a fork of the
project. It is also outside both rulesets, which is the point: the job never pushes to `dev` or
`main`, and a scheduled bot has no write access to anything that ships.

## Failure modes worth knowing

- **A missed day costs nothing.** The window is fourteen days wide and the job runs daily, so it
  would take fifteen consecutive failures to lose a date permanently. The symptom would be a badge
  that stops moving.
- **An empty or malformed response cannot erase a figure.** The fold skips any day whose `count` or
  `uniques` is not a number, so a bad response leaves the existing history untouched rather than
  replacing real numbers with zeroes.
- **The counts include automation.** CI checkouts, mirrors and scrapers all clone. These are traffic
  figures, not an audience estimate, and they should not be read as one.
- **Without the `TRAFFIC_READ_TOKEN` secret, nothing is recorded at all.** The traffic endpoints
  need `Administration: read`, and `GITHUB_TOKEN` cannot be granted it, so the job stops before
  fetching and writes the reason to its run summary. It exits green on purpose: a red run every
  morning for a secret nobody has created yet is how a repository learns to ignore a red run. Once
  the secret exists, any failure after that point is real and does go red.
- **This job lied for its entire life before 0.1.0.** The two window fetches were shell assignments
  prefixed to the `node` command, so `set -e` tested node's status and not `gh`'s. Every 403
  produced an empty window, a fold that wrote nothing, and a green tick. If you are reading this
  history, it starts from the day the secret was first set, not from the day the repository opened.
