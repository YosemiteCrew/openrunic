#!/usr/bin/env node
// Aikido has to have actually reviewed this pull request.
//
// `Aikido Security: Deep Review` reported `skipped` on every pull request for
// an unmeasured number of weeks with the summary "Aikido skipped this review
// because there are no credits left in the wallet." Nothing said so. #408 is
// the report; this is the half of it that lives in the repository.
//
// The problem is not that the wallet emptied - that is an owner action and no
// file here configures it. The problem is that emptying it produced `skipped`,
// and `skipped` is neither a failure nor a success: no red row, no
// notification, no entry in any list a reviewer reads. A security review was
// off and the pull request page rendered exactly what it renders when the
// review passes. `GUIDES/A_CHECK_THAT_DID_NOT_RUN_IS_NOT_A_CHECK_THAT_PASSED`
// collects six of these; this is the one that ran for weeks.
//
// So: read the checks Aikido posted on this head, and fail when one of them
// declined to run. The conclusion alone cannot say that - `skipped` is the same
// word for a wallet, a path filter and a draft - so the check's own
// `output.summary` is printed, which is the sentence that names the cause.
//
// ## What counts as declining
//
// `skipped`, `neutral`, `cancelled` and `stale`: the conclusions that render as
// neither pass nor fail. `failure` and `timed_out` are NOT this script's
// business. They are already loud, `Aikido Security: check code` is already a
// required context on both rulesets, and a second gate re-reporting a finding
// that is already red would make this one fire for a reason it was not built
// for - and then get muted for it.
//
// ## Why absence fails
//
// Zero Aikido checks on a head that has other checks is the same unmeasured
// state with less evidence, so it fails too, and it is reported separately from
// "there were no checks at all", which means the sha is wrong or nothing has
// started. That distinction is the point: the total the API declares is an
// independent number, and without it a guard that found nothing cannot tell
// "the rail read nothing" from "the rail found nothing".
//
// The cost of that choice is that an uninstalled app, a vendor outage, or
// Aikido renaming its checks all turn every pull request red. That is
// deliberate and it is the recoverable direction. The alternative - staying
// green when the scanner is absent - is the defect this exists to remove.
//
// Drafts are handled by the workflow, which does not run this on one, rather
// than by an exemption here. Aikido skips a draft on purpose and says so, and
// trusting that prose would put an unchecked claim in the one place a gate is
// allowed to skip itself. Not running is checkable; `github.event.pull_request.draft`
// is the fact, and a draft cannot merge anyway.
//
// Usage:
//   GITHUB_TOKEN=... node scripts/ci/aikido-coverage.mjs <owner/repo> <sha>
//
// Exit 0 when every Aikido check ran, 1 when one declined or none appeared,
// 2 on a usage error.
//
// ## Why a pass is confirmed and a decline is not
//
// `check code` is created up to two seconds before `Deep Review`. A poll inside
// that gap sees one completed `success` with nothing outstanding and would
// report a whole review off half of one. So a pass has to hold across two polls
// over the same set of contexts; a decline does not, because nothing arriving
// later makes a declined check into a run one.

import path from 'node:path';
import process from 'node:process';

/** The GitHub App that posts both Aikido contexts. Read off the check runs. */
export const AIKIDO_APP = 'aikido-pr-checks';

/**
 * Conclusions that are neither a pass nor a fail.
 *
 * Every one of these renders on the pull request page as an absence of a
 * finding, which is the thing that reads as a finding of nothing.
 */
export const DECLINED = new Set(['skipped', 'neutral', 'cancelled', 'stale']);

/** How long to wait for the app to post, and how often to look. */
export const DEADLINE_MS = 5 * 60 * 1000;
export const INTERVAL_MS = 15 * 1000;

/**
 * What the checks on one head say about whether Aikido reviewed it.
 *
 * `total` is the number of check runs on the head from every app, and it is
 * carried through on purpose: it is the only input here that does not come from
 * the same filter as the answer, so it is what separates "nothing has started"
 * from "plenty started and none of it was Aikido".
 */
export function classify(checkRuns, total = checkRuns.length) {
  const mine = checkRuns.filter((run) => run.app?.slug === AIKIDO_APP);
  if (mine.length === 0) return { verdict: total === 0 ? 'no-checks' : 'absent', total, runs: [] };
  if (mine.some((run) => run.status !== 'completed')) {
    return { verdict: 'running', total, runs: mine };
  }
  const declined = mine.filter((run) => DECLINED.has(run.conclusion));
  if (declined.length > 0) return { verdict: 'declined', total, runs: declined };
  return { verdict: 'reviewed', total, runs: mine };
}

/**
 * The Aikido contexts on a head, as one comparable string.
 *
 * Keyed on the check name rather than a count, so the owner disabling
 * `Deep Review` - one of the two remedies #408 asks for - settles on the
 * remaining context instead of waiting out the deadline for a second one that
 * is never coming.
 */
const contextsOf = (result) =>
  result.runs
    .map((run) => run.name)
    .sort((a, b) => a.localeCompare(b))
    .join('\n');

/**
 * Every check run on a ref.
 *
 * Paginated against the `total_count` the API itself reports rather than
 * against an empty page, so a truncated read fails here instead of becoming a
 * smaller, plausible answer downstream.
 */
export async function listCheckRuns(repo, sha, token, fetchImpl = fetch) {
  const runs = [];
  let total = 0;
  for (let page = 1; ; page += 1) {
    const url =
      `https://api.github.com/repos/${repo}/commits/${sha}/check-runs` +
      `?filter=latest&per_page=100&page=${String(page)}`;
    const response = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!response.ok) {
      throw new Error(`check-runs for ${sha} returned ${String(response.status)}`);
    }
    const body = await response.json();
    total = body.total_count ?? 0;
    const batch = body.check_runs ?? [];
    runs.push(...batch);
    if (batch.length === 0 || runs.length >= total) break;
  }
  if (runs.length !== total) {
    throw new Error(
      `check-runs for ${sha}: read ${String(runs.length)} of ${String(total)} the API reported`
    );
  }
  return runs;
}

/**
 * Poll until the answer cannot change, or until the deadline.
 *
 * A deadline rather than a fixed number of attempts: the two Aikido checks were
 * posted 6 seconds after a pull request opened and completed 28 seconds later,
 * so five minutes is an order of magnitude of headroom and still terminates.
 * Whatever is true at the deadline is the answer - `running` included, because
 * a review that has not finished by then has not reviewed anything either.
 *
 * `declined` settles on the poll that sees it; `reviewed` does not, and needs
 * the same set of contexts twice. The two are not symmetric because only one of
 * them can be undone by a later arrival. Aikido creates `check code` 0-2
 * seconds BEFORE `Deep Review` - measured 2026-09-21 on the eight most recently
 * merged heads: earlier on six, same second on two, later on none. A poll
 * landing in that gap sees one completed `success`, nothing outstanding, and
 * reads a half-posted review as a whole one - exit 0 and a green row, which is
 * the exact false pass this gate exists to remove. A check that declined, by
 * contrast, has declined whatever arrives after it.
 *
 * The gap is narrower than `intervalMs`, so this costs one extra poll on a
 * fully-reviewed head and nothing at all today, where every head declines.
 */
export async function awaitReview(repo, sha, token, options = {}) {
  const {
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    deadlineMs = DEADLINE_MS,
    intervalMs = INTERVAL_MS,
  } = options;

  const started = now();
  let confirming = null;
  for (;;) {
    const runs = await listCheckRuns(repo, sha, token, fetchImpl);
    const result = classify(runs);
    const settled =
      result.verdict === 'declined' ||
      (result.verdict === 'reviewed' && contextsOf(result) === confirming);
    if (settled || now() - started >= deadlineMs) return result;
    confirming = result.verdict === 'reviewed' ? contextsOf(result) : null;
    await sleep(intervalMs);
  }
}

/** The announcement, which is the whole point of the gate. */
export function describe(result, sha) {
  const head = `aikido-coverage: ${sha}`;
  const lines = result.runs.map(
    (run) =>
      `  ${run.name}  ${run.conclusion ?? run.status}\n` +
      `    ${run.output?.title ?? '(no title)'}\n` +
      `    ${(run.output?.summary ?? '(no summary)').split('\n')[0]}`
  );
  switch (result.verdict) {
    case 'reviewed':
      return `${head}: ${String(result.runs.length)} Aikido check(s) ran.\n${lines.join('\n')}\n`;
    case 'declined':
      return (
        `${head}: Aikido did not review this pull request.\n\n${lines.join('\n')}\n\n` +
        'A declined check is not a passed check. Read the summary above: it names the\n' +
        'cause, and the conclusion does not. An empty credit wallet is an owner action -\n' +
        'nothing in this repository configures it - and until it is resolved no Aikido\n' +
        'review is happening on any pull request, whatever the pull request page shows.\n'
      );
    case 'running':
      return (
        `${head}: Aikido was still running at the deadline.\n\n${lines.join('\n')}\n\n` +
        'A review that has not finished has not reviewed anything. Re-run this check once\n' +
        'the Aikido checks above have completed.\n'
      );
    case 'absent':
      return (
        `${head}: ${String(result.total)} check run(s) on this head and none from ` +
        `${AIKIDO_APP}.\n\n` +
        'Other apps posted, so the head is right and checks are running; Aikido is the one\n' +
        'that is missing. Check that the app is still installed, and that it has not\n' +
        'renamed the app slug this gate matches on.\n'
      );
    default:
      return (
        `${head}: no check runs at all on this head.\n\n` +
        'Nothing has started, or the sha is wrong. This gate cannot say anything about a\n' +
        'head no app has looked at.\n'
      );
  }
}

async function main(argv, env) {
  const [repo, sha] = argv;
  const token = env.GITHUB_TOKEN;
  if (!repo || !sha || !token) {
    process.stderr.write(
      'usage: GITHUB_TOKEN=... node scripts/ci/aikido-coverage.mjs <owner/repo> <sha>\n'
    );
    return 2;
  }
  const result = await awaitReview(repo, sha, token);
  process.stdout.write(describe(result, sha));
  return result.verdict === 'reviewed' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(await main(process.argv.slice(2), process.env));
}
