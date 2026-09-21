import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AIKIDO_APP, awaitReview, classify, describe, listCheckRuns } from './aikido-coverage.mjs';

// The two summaries below are the measured ones, copied off
// `commits/<sha>/check-runs` rather than paraphrased. They are the whole reason
// the gate reads `output.summary`: both arrive with conclusion `skipped`, and
// only the sentence separates a wallet that has emptied from a draft that
// nobody meant to scan yet.
const NO_CREDITS = 'Aikido skipped this review because there are no credits left in the wallet.';
const DRAFT = 'Aikido skipped this check because the PR is in draft status.';

/** A check run with only the fields the gate reads. */
const run = (name, conclusion, summary, slug = AIKIDO_APP) => ({
  name,
  status: conclusion === null ? 'in_progress' : 'completed',
  conclusion,
  app: { slug },
  output: { title: conclusion === 'skipped' ? 'Check skipped' : 'Scan completed', summary },
});

const deepReview = (conclusion, summary) =>
  run('Aikido Security: Deep Review', conclusion, summary);
const checkCode = (conclusion, summary) => run('Aikido Security: check code', conclusion, summary);
const other = (name, conclusion) => run(name, conclusion, 'unrelated', 'github-actions');

test('a completed scan is a review', () => {
  const result = classify([
    checkCode('success', 'Aikido Security check OK. No new issues were introduced.'),
    deepReview('success', 'No issues found.'),
  ]);
  assert.equal(result.verdict, 'reviewed');
  assert.equal(result.runs.length, 2);
});

test('an empty wallet is a decline, not a pass', () => {
  const result = classify([
    checkCode('success', 'Aikido Security check OK. No new issues were introduced.'),
    deepReview('skipped', NO_CREDITS),
  ]);
  assert.equal(result.verdict, 'declined');
  // Only the check that declined, so the message names the one that is off
  // rather than every Aikido context on the head.
  assert.deepEqual(
    result.runs.map((entry) => entry.name),
    ['Aikido Security: Deep Review']
  );
});

test('a draft skip is a decline here too, because the workflow is what excuses a draft', () => {
  // The prose differs from NO_CREDITS and the verdict must not: an exemption
  // keyed on the vendor's sentence would be an unchecked claim in the one place
  // the gate is allowed to skip itself. `pull_request.draft` is the fact, and
  // it is read by the workflow, which does not start this on a draft.
  assert.equal(classify([checkCode('skipped', DRAFT)]).verdict, 'declined');
});

test('a finding is not this gate’s business', () => {
  // `Aikido Security: check code` is a required context and reports its own
  // findings. If a `failure` also failed here, the gate would fire for a reason
  // it was not built for and get muted for it.
  const result = classify([
    checkCode('failure', 'Aikido Security found issues. 1 new HIGH issue was introduced.'),
  ]);
  assert.equal(result.verdict, 'reviewed');
});

test('an unfinished check is neither', () => {
  assert.equal(
    classify([checkCode(null, undefined), deepReview('success', 'ok')]).verdict,
    'running'
  );
});

test('no Aikido check among other apps is absent, and an empty head is not', () => {
  // The separating input is the total, which does not come from the same filter
  // as the answer. With only the filtered list both rows are "found nothing".
  const absent = classify([other('CI Required', 'success'), other('CodeQL', 'success')]);
  assert.equal(absent.verdict, 'absent');
  assert.equal(absent.total, 2);

  const empty = classify([]);
  assert.equal(empty.verdict, 'no-checks');
  assert.equal(empty.total, 0);
});

test('the total may be supplied independently of the list', () => {
  // Pagination hands `classify` a list it did not measure itself. A head where
  // the only page read held no Aikido check is still `absent` when the API said
  // there were 45 checks.
  assert.equal(classify([], 45).verdict, 'absent');
});

/** A fetch stub returning canned page bodies in order, counting its calls. */
function stubFetch(...pages) {
  const calls = [];
  const impl = (url, init) => {
    calls.push({ url, init });
    const next = pages[calls.length - 1];
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: () => Promise.resolve(next.body),
    });
  };
  impl.calls = calls;
  return impl;
}

const page = (total, runs) => ({ body: { total_count: total, check_runs: runs } });

test('listCheckRuns follows pages until it has what the API said there was', async () => {
  const first = Array.from({ length: 100 }, (_, index) =>
    other(`filler ${String(index)}`, 'success')
  );
  const fetchImpl = stubFetch(page(101, first), page(101, [deepReview('skipped', NO_CREDITS)]));
  const runs = await listCheckRuns('o/r', 'abc', 't', fetchImpl);

  assert.equal(runs.length, 101);
  assert.equal(classify(runs).verdict, 'declined');
  assert.equal(fetchImpl.calls.length, 2);
  assert.match(fetchImpl.calls[0].url, /\/repos\/o\/r\/commits\/abc\/check-runs\?/u);
  assert.match(fetchImpl.calls[1].url, /[?&]page=2\b/u);
  // `filter=latest` is what the draft reasoning rests on, and nothing else
  // here would notice it going. Without it the endpoint returns every attempt
  // on the sha, so a pull request opened as a draft and then marked ready
  // carries its stale draft `skipped` beside the fresh run and reports
  // `declined` for a state that has already been resolved. Moot while Deep
  // Review skips unconditionally; live the moment the wallet is funded, which
  // is the state this gate exists to survive into.
  assert.match(fetchImpl.calls[0].url, /[?&]filter=latest\b/u);
  assert.equal(fetchImpl.calls[0].init.headers.authorization, 'Bearer t');
});

test('a short read is an error, not a smaller answer', async () => {
  // Without this the gate would read 1 of 45 checks, find no Aikido among them,
  // and report `absent` - a plausible wrong answer built out of a truncation.
  const fetchImpl = stubFetch(page(45, [other('CI Required', 'success')]), page(45, []));
  await assert.rejects(() => listCheckRuns('o/r', 'abc', 't', fetchImpl), /read 1 of 45/u);
});

test('an HTTP error is raised rather than read as an empty head', async () => {
  const fetchImpl = stubFetch({ ok: false, status: 404, body: {} });
  await assert.rejects(() => listCheckRuns('o/r', 'abc', 't', fetchImpl), /returned 404/u);
});

/** A clock that advances by `step` on every read. */
function clock(step) {
  let t = 0;
  return () => {
    const current = t;
    t += step;
    return current;
  };
}

test('awaitReview polls while Aikido is still running and stops once it settles', async () => {
  const fetchImpl = stubFetch(
    page(1, [checkCode(null, undefined)]),
    page(1, [checkCode(null, undefined)]),
    page(2, [checkCode('success', 'ok'), deepReview('skipped', NO_CREDITS)])
  );
  const slept = [];
  const result = await awaitReview('o/r', 'abc', 't', {
    fetchImpl,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    now: clock(1000),
    deadlineMs: 60_000,
    intervalMs: 15_000,
  });

  assert.equal(result.verdict, 'declined');
  assert.deepEqual(slept, [15_000, 15_000]);
});

test('awaitReview gives up at the deadline and reports what was true then', async () => {
  const fetchImpl = stubFetch(page(1, [checkCode(null, undefined)]));
  const slept = [];
  const result = await awaitReview('o/r', 'abc', 't', {
    fetchImpl,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    // `started` takes the first read, 0; the deadline test takes the second,
    // 5000, which is already past 4000. So the loop returns after ONE fetch
    // and never sleeps, and both are asserted rather than described - the
    // stub is given a single page so a second fetch would throw rather than
    // quietly succeed.
    now: clock(5000),
    deadlineMs: 4000,
    intervalMs: 15_000,
  });

  assert.equal(result.verdict, 'running');
  assert.equal(fetchImpl.calls.length, 1);
  assert.deepEqual(slept, []);
});

test('the announcement carries the sentence that names the cause', () => {
  const message = describe(classify([deepReview('skipped', NO_CREDITS)]), 'abc123');
  assert.match(message, /abc123/u);
  assert.match(message, /Aikido Security: Deep Review/u);
  assert.match(message, /skipped/u);
  // The whole defect in one assertion: the conclusion is the same word for
  // three causes, so the gate has to print the summary.
  assert.ok(message.includes(NO_CREDITS), 'the wallet sentence must reach the log');
});

test('absent and no-checks say different things', () => {
  const absent = describe(classify([other('CI Required', 'success')]), 'abc');
  assert.match(absent, /none from aikido-pr-checks/u);
  assert.match(describe(classify([]), 'abc'), /no check runs at all/u);
});
