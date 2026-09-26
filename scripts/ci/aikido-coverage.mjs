#!/usr/bin/env node
// Aikido has to have actually reviewed this pull request.
//
// The Aikido contexts are posted by a GitHub App, so nothing in this repository
// decides whether they run. A review that declines reports `skipped`, and
// `skipped` is neither a failure nor a success: no red row, no notification, no
// entry in any list a reviewer reads, and the pull request page renders exactly
// what it renders when the review passes. #408 is the report; this is the half
// of it that lives in the repository.
//
// So: read the checks Aikido posted on this head, and fail when one of them
// declined to run. The conclusion alone cannot say that - `skipped` is the same
// word for several causes, a path filter and a draft among them - so the
// check's own `output.summary` is printed, which is the sentence that names the
// cause.
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
// conclusion `skipped`, on a head whose COMMIT author GitHub reports as a
// `Bot` - the pull request's author is a different fact and the wrong one. The
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
// ## The checks this repository's plan includes
//
// PLAN_FILE lists them. When it exists, each listed check has to be posted and
// reach a verdict, and an Aikido check that is NOT listed and reports `skipped`
// is printed as a notice rather than failing the job - see isOutsidePlan. When
// it does not exist, every Aikido check has to run, which is the behaviour this
// file had before the plan file did. A file that cannot be read as a plan fails
// the job: see parsePlan.
//
// Usage:
//   GITHUB_TOKEN=... node scripts/ci/aikido-coverage.mjs <owner/repo> <sha>
//
// Exit 0 when every required Aikido check ran, 1 when one declined, none
// appeared, a listed one is missing or the plan file is malformed, 2 on a usage
// error.
//
// ## Why a pass is confirmed and a decline is not
//
// `check code` is created up to two seconds before `Deep Review`. A poll inside
// that gap sees one completed `success` with nothing outstanding and would
// report a whole review off half of one. So a pass has to hold across two polls
// over the same set of contexts; a decline does not, because nothing arriving
// later makes a declined check into a run one.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** The GitHub App that posts both Aikido contexts. Read off the check runs. */
export const AIKIDO_APP = 'aikido-pr-checks';

/** Where the plan is declared, relative to the repository root. */
export const PLAN_FILE = '.github/aikido-plan.json';
const PLAN_PATH = path.join(import.meta.dirname, '..', '..', PLAN_FILE);

/**
 * The context every plan has to list.
 *
 * It is the required context on both rulesets, and GitHub satisfies a required
 * check on `skipped` - so this gate is what makes a skipped `check code` red,
 * and a plan file that dropped it would turn that into a notice. The floor
 * lives in the code so that editing one JSON line cannot do that.
 */
export const ALWAYS_INCLUDED = 'Aikido Security: check code';

/**
 * Read the plan: the list of check names, or null when there is no file.
 *
 * Only a missing file is null, and null is the strict default. Any other read
 * error, and any content parsePlan refuses, throws: a plan the gate cannot
 * read is not a plan it may relax itself on. `read` is there for the tests;
 * the job always reads PLAN_FILE.
 */
export function loadPlan(read = () => readFileSync(PLAN_PATH, 'utf8')) {
  let text;
  try {
    text = read();
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  return parsePlan(text);
}

/**
 * Exactly `{ "included": [<check name>, ...] }`, non-empty, naming ALWAYS_INCLUDED.
 *
 * An unknown key is refused rather than ignored, so a key someone expects to
 * mean something (`"optional"`, a misspelt `"include"`) cannot sit in the file
 * doing nothing.
 */
export function parsePlan(text) {
  const refuse = (why) => {
    throw new Error(
      `${PLAN_FILE}: ${why}. The plan is not applied and the job fails; fix the file, or delete ` +
        'it to require every Aikido check.'
    );
  };
  let plan;
  try {
    plan = JSON.parse(text);
  } catch (error) {
    refuse(`not valid JSON (${error.message})`);
  }
  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
    refuse('expected a JSON object');
  }
  const keys = Object.keys(plan);
  if (keys.length !== 1 || keys[0] !== 'included') {
    refuse(`expected exactly one key, "included", found ${JSON.stringify(keys)}`);
  }
  const { included } = plan;
  if (
    !Array.isArray(included) ||
    included.length === 0 ||
    included.some((name) => typeof name !== 'string' || name === '')
  ) {
    refuse('"included" must be a non-empty list of check names');
  }
  if (!included.includes(ALWAYS_INCLUDED)) {
    refuse(`"included" must list "${ALWAYS_INCLUDED}"`);
  }
  return Object.freeze([...included]);
}

/**
 * Whether this run is a check the plan does not include, reporting `skipped`.
 *
 * Name and conclusion, the same shape as BOT_EXEMPT. Only `skipped`: an
 * unlisted check that reports anything else outside REACHED_A_VERDICT still
 * declines. With no plan nothing is outside it.
 */
export const isOutsidePlan = (run, plan) =>
  plan !== null && !plan.includes(run.name) && run.conclusion === 'skipped';

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
 * when it needs a human to go and do something. The denylist this replaced did
 * not name it, so it was scoring exit 0 and a green row.
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
 * vendor declines it before any other setting is consulted, so every cause
 * produces the identical `skipped` on that context. A gate cannot report a
 * state it cannot observe, and every other cause remains observable on every
 * human-authored head, where this exemption does not apply.
 *
 * What would be a silencing is exempting the head. `Aikido Security: check
 * code` is the required context, it carries the SCA, and it RUNS on a
 * bot-authored head - `success` on all three of this repository's dependabot
 * pull requests, measured on #546, #491 and #414. So it is observable there,
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
 * Keyed on the HEAD COMMIT's author, read from the API, and never on the
 * summary prose.
 *
 * The commit's author and not the pull request's. Those are the same fact on a
 * clean dependabot branch and different the moment a human pushes onto one - a
 * hand-fixed lockfile conflict, a review fix. There `pull_request.user.type` is
 * still `Bot` while Aikido's rule does not fire, so an exemption keyed on the
 * pull request author would excuse a Deep Review that skipped for some OTHER
 * cause, and silence exactly the state this gate exists to report.
 */
export const BOT_EXEMPT = Object.freeze({
  name: 'Aikido Security: Deep Review',
  conclusion: 'skipped',
});

/** Whether this run is the one absence a bot-authored head is excused. */
export const isBotExempt = (run) =>
  run.name === BOT_EXEMPT.name && run.conclusion === BOT_EXEMPT.conclusion;

/**
 * Whether this commit is AUTHORED by a bot account.
 *
 * `.author`, never `.committer`. On a dependabot commit the committer is
 * GitHub's own web-flow account and reads `User`, so the two fields disagree on
 * exactly the head this exemption is about - measured on `2cbbf64`, PR #546:
 * `.author.type` `Bot`, `.committer.type` `User`.
 *
 * `.author` is the account GitHub matched to the commit's author email and is
 * null when it matched nothing. Null reads as not-a-bot, which is the
 * fail-closed direction the rest of this file takes: an unrecognised head keeps
 * the gate strict rather than excusing a context on it.
 *
 * A non-ok response throws, for the same reason - the gate cannot decide an
 * exemption it could not read, and the recoverable direction is red.
 */
export async function headCommitIsBot(repo, sha, token, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/commits/${sha}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`commit ${sha} returned ${String(response.status)}`);
  }
  const body = await response.json();
  // The comparison lives HERE, inside the function the tests call, and not at
  // the call site. A predicate spelled out at the call site and re-spelled in
  // the test is pinned by nothing: loosening this to a truthiness check left
  // every test green when it was written that way, which is how it was found.
  return (body.author?.type ?? null) === 'Bot';
}

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
  const { headAuthoredByBot = false, plan = null } = options;
  const mine = checkRuns.filter((run) => run.app?.slug === AIKIDO_APP);
  const none = { total, runs: [], exempt: [], notices: [] };
  if (mine.length === 0) return { verdict: total === 0 ? 'no-checks' : 'absent', ...none };
  const exempt = headAuthoredByBot ? mine.filter(isBotExempt) : [];
  // Before the running check, so a skipped check outside the plan is still
  // reported on a head where another check is outstanding at the deadline.
  const notices = mine.filter((run) => !exempt.includes(run) && isOutsidePlan(run, plan));
  if (mine.some((run) => run.status !== 'completed')) {
    const runs = mine.filter((run) => !notices.includes(run));
    return { verdict: 'running', total, runs, exempt: [], notices };
  }
  const rest = mine.filter((run) => !exempt.includes(run) && !notices.includes(run));
  const declined = rest.filter((run) => !REACHED_A_VERDICT.has(run.conclusion));
  if (declined.length > 0) return { verdict: 'declined', total, runs: declined, exempt, notices };
  // A listed check that was never posted has not run, and a later poll may
  // still bring it, so this is not a settled verdict: awaitReview polls on to
  // the deadline and reports it then.
  const missing = (plan ?? []).filter((name) => !mine.some((run) => run.name === name));
  if (missing.length > 0) {
    return { verdict: 'missing', total, runs: mine, exempt, notices, missing };
  }
  // Everything Aikido posted was the excused one. The exemption covers Deep
  // Review and nothing else, so a head carrying only that has not been scanned,
  // and reading it as a review is the exact false pass this gate removes.
  if (rest.length === 0) return { verdict: 'only-exempt', total, runs: mine, exempt, notices };
  return { verdict: 'reviewed', total, runs: rest, exempt, notices };
}

/**
 * The Aikido contexts on a head, as one comparable string.
 *
 * Keyed on the check name rather than a count, so a repository with
 * `Deep Review` disabled settles on the remaining context instead of waiting
 * out the deadline for a second one that is never coming.
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
 * fully-reviewed head and nothing on a head that declines.
 */
export async function awaitReview(repo, sha, token, options = {}) {
  const {
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    deadlineMs = DEADLINE_MS,
    intervalMs = INTERVAL_MS,
    headAuthoredByBot = false,
    plan = null,
  } = options;

  const started = now();
  let confirming = null;
  for (;;) {
    const runs = await listCheckRuns(repo, sha, token, fetchImpl);
    const result = classify(runs, runs.length, { headAuthoredByBot, plan });
    const settled =
      result.verdict === 'declined' ||
      (result.verdict === 'reviewed' && contextsOf(result) === confirming);
    if (settled || now() - started >= deadlineMs) return result;
    confirming = result.verdict === 'reviewed' ? contextsOf(result) : null;
    await sleep(intervalMs);
  }
}

/**
 * Escape workflow-command data: `%`, CR and LF. Unescaped, the runner ends the
 * notice at the first line break and decodes a literal `%` wrongly.
 */
const escapeCommand = (text) =>
  text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

/**
 * One line of log text. Check names, titles and summaries come from the API,
 * and a line break inside one would start a line of its own, which the runner
 * reads as a workflow command when it begins with `::`.
 */
const oneLine = (text) => String(text).replaceAll(/[\r\n]+/gu, ' ');
const summaryOf = (run) => oneLine((run.output?.summary ?? '(no summary)').split('\n')[0]);

/** The announcement, which is the whole point of the gate. */
export function describe(result, sha) {
  const head = `aikido-coverage: ${sha}`;
  const lines = result.runs.map(
    (run) =>
      `  ${oneLine(run.name)}  ${oneLine(run.conclusion ?? run.status)}\n` +
      `    ${oneLine(run.output?.title ?? '(no title)')}\n` +
      `    ${summaryOf(run)}`
  );
  const exemptions = (result.exempt ?? [])
    .map(
      (run) =>
        `  ${oneLine(run.name)}  ${String(run.conclusion)}  EXEMPT: the head is bot-authored, and\n` +
        '    Aikido declines this context on every bot-authored head.\n' +
        '    Accepted 2026-09-22, #549. See docs/security-gates.md.\n'
    )
    .join('');
  // Said out loud twice: in the log beside the checks that ran, and as a
  // workflow notice so it shows on the run summary without opening the log.
  const notices = (result.notices ?? [])
    .map(
      (run) =>
        `  ${oneLine(run.name)}  ${String(run.conclusion)}  NOTICE: not a check this repository's\n` +
        `    plan includes (${PLAN_FILE}), so it is reported and not required.\n` +
        `    ${summaryOf(run)}\n` +
        `::notice::${escapeCommand(
          `${run.name} reported ${String(run.conclusion)}. It is not a check this ` +
            `repository's plan includes (${PLAN_FILE}), so it is not required.`
        )}\n`
    )
    .join('');
  switch (result.verdict) {
    case 'reviewed':
      return (
        `${head}: ${String(result.runs.length)} Aikido check(s) ran.\n${lines.join('\n')}\n` +
        // An accepted absence still gets said out loud. A gate that skips part
        // of itself silently is the shape this whole file exists to remove.
        exemptions +
        notices
      );
    case 'declined':
      return (
        `${head}: Aikido did not review this pull request.\n\n${lines.join('\n')}\n\n` +
        'A declined check is not a passed check. Read the summary above: it names the\n' +
        'cause, and the conclusion does not. Until that cause is resolved, no Aikido\n' +
        'review is happening on this pull request, whatever the pull request page shows.\n' +
        notices
      );
    case 'missing':
      return (
        `${head}: a check this repository's plan includes was not posted.\n\n` +
        result.missing.map((name) => `  missing: ${oneLine(name)}\n`).join('') +
        `\n${lines.join('\n')}\n\n` +
        `Every check listed in ${PLAN_FILE} has to run on the head. Check that the app is\n` +
        'still installed and has not renamed the context, or correct the name in the file.\n' +
        notices
      );
    case 'running':
      return (
        `${head}: Aikido was still running at the deadline.\n\n${lines.join('\n')}\n\n` +
        'A review that has not finished has not reviewed anything. Re-run this check once\n' +
        'the Aikido checks above have completed.\n' +
        notices
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
  let plan;
  try {
    plan = loadPlan();
  } catch (error) {
    process.stderr.write(`aikido-coverage: ${error.message}\n`);
    return 1;
  }
  process.stdout.write(
    plan === null
      ? `aikido-coverage: no ${PLAN_FILE}, so every Aikido check has to run.\n`
      : `aikido-coverage: ${PLAN_FILE} includes: ${plan.join(', ')}.\n`
  );
  // One extra request, on the same host the gate already talks to, so the
  // predicate it implements is the one the vendor documents.
  const result = await awaitReview(repo, sha, token, {
    headAuthoredByBot: await headCommitIsBot(repo, sha, token),
    plan,
  });
  process.stdout.write(describe(result, sha));
  return result.verdict === 'reviewed' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(await main(process.argv.slice(2), process.env));
}
