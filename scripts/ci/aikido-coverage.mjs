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
// Anything that is not `success`, `failure` or `timed_out`. Stated as an
// allowlist on purpose: a list of the conclusions that decline leaves every
// value nobody thought of falling through to the pass, which is this gate's
// own defect one layer up. GitHub publishes two disagreeing enums for this one
// field, so there is no single list to write a denylist against - see
// REACHED_A_VERDICT. `failure` and `timed_out` are in the allowlist because
// they are already loud and already required, not because they are reviews.
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
// There is one exemption and it is narrow: `Aikido Security: Deep Review`,
// conclusion `skipped`, on a head whose author GitHub reports as a `Bot`. The
// vendor declines that context on a bot-authored head before any other reason
// is consulted, so there is no signal there to lose - see BOT_EXEMPT, which
// carries the argument and the measurement. `check code` is still required of a
// bot head, because it runs on one.
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
 * The conclusions that mean Aikido reached a verdict on this head.
 *
 * An allowlist, not a denylist, and the direction is the point.
 *
 * Three members, each for its own reason:
 *
 * - `success` - it ran and it passed. The only one that is a review.
 * - `failure` and `timed_out` - a real red result. NOT this gate's business:
 *   `Aikido Security: check code` is already a required context on both
 *   rulesets and already loud, and a second gate re-reporting a finding that
 *   is already red would fire for a reason it was not built for, and then get
 *   muted for it.
 *
 * Everything else declines, `action_required` included - what an app posts
 * when it needs a human to go and do something, an empty wallet being the
 * example this file exists for. The denylist this replaced did not name it,
 * so it was scoring exit 0 and a green row.
 *
 * ## Why the direction matters more than the membership
 *
 * There is no single list to write a denylist against. GitHub publishes two
 * enums for this one field and they disagree (github/rest-api-description):
 *
 *   POST/PATCH .../check-runs, request `conclusion`   8 values, incl. `stale`
 *   components/schemas/check-run, response            7 values, no `stale`
 *
 * So an app may legally POST a conclusion that the schema describing what you
 * read back does not list. A denylist written from the response enum omits
 * `stale`; one written from the request enum is complete today and silently
 * incomplete the day either list grows. An allowlist is correct against both,
 * and stays correct against a third.
 *
 * That is the same defect this gate exists for, one layer further out: a value
 * the reader has no case for rendering as the case where nothing is wrong.
 */
export const REACHED_A_VERDICT = new Set(['success', 'failure', 'timed_out']);

/**
 * The one context, and the one conclusion, that a bot-authored head is excused.
 *
 * Aikido declines Deep Review on any head whose latest commit was authored by a
 * bot, with the summary "Aikido skipped this review because the latest commit
 * was authored by a bot." That is a vendor rule, it is true by construction of
 * the head, and nothing on the branch can change it - so every dependabot pull
 * request was a permanent red row on a check that had already said everything
 * it had to say (#549).
 *
 * ## Why this is an acceptance and not a silencing
 *
 * Exempting a skip is the move #408 exists to argue against, so the reason it
 * is right here has to be the thing that is different, and it is this: on a
 * bot-authored head there is no Deep Review signal to lose, of any cause. The
 * vendor declines it before the wallet, the strictness or the path filter is
 * ever consulted, so a wallet that emptied and a wallet that is full produce
 * the identical `skipped` on that context. A gate cannot report a state it
 * cannot observe, and the empty wallet remains observable on every
 * human-authored head, where this exemption does not apply.
 *
 * What would be a silencing is exempting the head. `Aikido Security: check
 * code` is the required context, it carries the SCA, and it RUNS on a
 * bot-authored head - `success` on all three of this repository's dependabot
 * pull requests, measured on #546, #491 and #414. It is also the context the
 * wallet does not reach (docs/security-gates.md). So it is observable there,
 * and it is left fully guarded.
 *
 * That guard is not redundant with the ruleset. GitHub's required status checks
 * are satisfied by "a successful, skipped, or neutral status" - so a required
 * `check code` that reported `skipped` would merge, and this is the only thing
 * on the head that would say so.
 *
 * ## Why it is a name and a conclusion, and frozen
 *
 * The pair is the exemption. Not "Deep Review on a bot head", which would
 * excuse it declining for a cause that is not the bot rule; not "anything
 * skipped on a bot head", which would excuse `check code`. Widening either half
 * is invisible to every test that only makes legal calls, so the membership is
 * asserted directly in the tests rather than only exercised.
 *
 * Keyed on `pull_request.user.type`, which the workflow passes in - the fact
 * GitHub supplies - and never on the summary prose, for the same reason the
 * draft exemption lives in the workflow rather than here.
 */
export const BOT_EXEMPT = Object.freeze({
  name: 'Aikido Security: Deep Review',
  conclusion: 'skipped',
});

/** Whether this run is the one absence a bot-authored head is excused. */
export const isBotExempt = (run) =>
  run.name === BOT_EXEMPT.name && run.conclusion === BOT_EXEMPT.conclusion;

/**
 * Whether the workflow reported this head's author as a bot.
 *
 * Exported so the tests read the same expression the gate runs rather than a
 * copy of it. A test that retypes `env.X === 'Bot'` in its own body pins
 * nothing: the constant and the fixture come from the same place, and changing
 * the gate to `Boolean(env.X)` leaves it green.
 *
 * Strict equality on the exact string, so an absent, empty or differently-cased
 * value is not a bot and the gate stays strict. Fail-closed is the direction
 * that a typo in the workflow recovers from.
 */
export const headIsBot = (env) => env.HEAD_AUTHOR_TYPE === 'Bot';

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
export function classify(checkRuns, total = checkRuns.length, options = {}) {
  const { headAuthoredByBot = false } = options;
  const mine = checkRuns.filter((run) => run.app?.slug === AIKIDO_APP);
  const none = { total, runs: [], exempt: [] };
  if (mine.length === 0) return { verdict: total === 0 ? 'no-checks' : 'absent', ...none };
  if (mine.some((run) => run.status !== 'completed')) {
    return { verdict: 'running', total, runs: mine, exempt: [] };
  }
  const exempt = headAuthoredByBot ? mine.filter(isBotExempt) : [];
  const rest = mine.filter((run) => !exempt.includes(run));
  // Everything Aikido posted was the excused one. The exemption covers Deep
  // Review and nothing else, so a head carrying only that has not been scanned,
  // and reading it as a review is the exact false pass this gate removes.
  if (rest.length === 0) return { verdict: 'only-exempt', total, runs: mine, exempt };
  const declined = rest.filter((run) => !REACHED_A_VERDICT.has(run.conclusion));
  if (declined.length > 0) return { verdict: 'declined', total, runs: declined, exempt };
  return { verdict: 'reviewed', total, runs: rest, exempt };
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
 * Two polls *in a row*, which is why the confirmation is reset rather than only
 * overwritten. A re-requested check goes back to `in_progress` and forward
 * again under the same name, so the set can read identically either side of a
 * poll that saw the head unsettled - and that middle poll is the evidence the
 * earlier read would otherwise be vouching for.
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
    headAuthoredByBot = false,
  } = options;

  const started = now();
  let confirming = null;
  for (;;) {
    const runs = await listCheckRuns(repo, sha, token, fetchImpl);
    const result = classify(runs, runs.length, { headAuthoredByBot });
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
  const exemptions = (result.exempt ?? [])
    .map(
      (run) =>
        `  ${run.name}  ${String(run.conclusion)}  EXEMPT: the head is bot-authored, and\n` +
        '    Aikido declines this context on a bot-authored head whatever the wallet says.\n' +
        '    Accepted 2026-09-22, #549. See docs/security-gates.md.\n'
    )
    .join('');
  switch (result.verdict) {
    case 'reviewed':
      return (
        `${head}: ${String(result.runs.length)} Aikido check(s) ran.\n${lines.join('\n')}\n` +
        // An accepted absence still gets said out loud. A gate that skips part
        // of itself silently is the shape this whole file exists to remove.
        exemptions
      );
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
    case 'only-exempt':
      return (
        `${head}: the only Aikido check on this head is the one a bot-authored head is\n` +
        `excused, so nothing scanned it.\n\n${lines.join('\n')}\n\n` +
        `The exemption covers ${BOT_EXEMPT.name} and nothing else.\n` +
        'Aikido Security: check code is the required context, it carries the SCA, and it\n' +
        'runs on a bot-authored head - so its absence here is a real absence. Check that\n' +
        'the app is still installed and has not renamed the context this gate matches.\n'
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
  // `pull_request.user.type`, handed in by the workflow. Absent reads as not a
  // bot, so a missing or misspelled variable leaves the gate strict.
  const result = await awaitReview(repo, sha, token, {
    headAuthoredByBot: headIsBot(env),
  });
  process.stdout.write(describe(result, sha));
  return result.verdict === 'reviewed' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(await main(process.argv.slice(2), process.env));
}
