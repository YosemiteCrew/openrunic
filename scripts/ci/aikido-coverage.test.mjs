import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  AIKIDO_APP,
  BOT_EXEMPT,
  REACHED_A_VERDICT,
  awaitReview,
  classify,
  describe,
  headCommitIsBot,
  isBotExempt,
  listCheckRuns,
} from './aikido-coverage.mjs';

// The two summaries below are the measured ones, copied off
// `commits/<sha>/check-runs` rather than paraphrased. They are the whole reason
// the gate reads `output.summary`: both arrive with conclusion `skipped`, and
// only the sentence separates a wallet that has emptied from a draft that
// nobody meant to scan yet.
const NO_CREDITS = 'Aikido skipped this review because there are no credits left in the wallet.';
const DRAFT = 'Aikido skipped this check because the PR is in draft status.';
const BOT = 'Aikido skipped this review because the latest commit was authored by a bot.';

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

test('action_required is a decline, and it is the one the denylist missed', () => {
  // The first version of this gate named four conclusions as declining, so
  // everything it did not name fell through to the pass. Two of those -
  // `failure` and `timed_out` - are deliberate (see above). `action_required`
  // was not: it is what an app posts when it needs a human to go and do
  // something, which is precisely the empty wallet this file exists for, and
  // it was scoring exit 0.
  assert.equal(
    classify([deepReview('action_required', 'Add credits to continue reviewing.')]).verdict,
    'declined'
  );
});

test('every conclusion GitHub publishes lands on a stated side, from both of its disagreeing enums', () => {
  // GitHub publishes two enums for this one field and they are not the same
  // list. Both copied from github/rest-api-description rather than remembered,
  // and written out in full so a member gaining a side is a diff here.
  //
  // `stale` is the disagreement: an app may legally POST it, and the schema
  // describing what you read back does not list it. That is why the fix is the
  // DIRECTION of the list and not its membership - a denylist is written
  // against one of these two and is wrong against the other.
  const REQUEST = [
    'action_required',
    'cancelled',
    'failure',
    'neutral',
    'skipped',
    'stale',
    'success',
    'timed_out',
  ];
  const RESPONSE = [
    'success',
    'failure',
    'neutral',
    'cancelled',
    'skipped',
    'timed_out',
    'action_required',
  ];
  assert.deepEqual(
    REQUEST.filter((c) => !RESPONSE.includes(c)),
    ['stale'],
    'the two enums must still differ by exactly `stale`; re-read the schema if this fails'
  );
  assert.equal(REQUEST.length, 8);
  assert.equal(RESPONSE.length, 7);

  const every = [...new Set([...REQUEST, ...RESPONSE])];
  const verdicts = new Map(
    every.map((conclusion) => [conclusion, classify([checkCode(conclusion, 'x')]).verdict])
  );

  // `success` is the review. `failure` and `timed_out` are already loud and
  // already required, so they are out of scope rather than passes. Every other
  // member - including `stale`, which only one of the two enums has - declines.
  assert.deepEqual(every.filter((c) => verdicts.get(c) === 'reviewed').sort(), [
    'failure',
    'success',
    'timed_out',
  ]);
  assert.deepEqual(every.filter((c) => verdicts.get(c) === 'declined').sort(), [
    'action_required',
    'cancelled',
    'neutral',
    'skipped',
    'stale',
  ]);
  assert.equal(every.length, 8);
});

test('a conclusion in neither enum declines rather than passing', () => {
  // The direction of the list, asserted rather than argued. A value the gate
  // has never heard of - a vendor bug, a GitHub addition, a field that arrived
  // empty - must not be the value that renders as a review. Two published
  // enums already disagree by a member, so a third list is not a hypothetical.
  // With a denylist each of these is `reviewed`; with an allowlist none is.
  for (const conclusion of ['startup_failure', 'action_needed', '', 'SUCCESS']) {
    assert.equal(
      classify([checkCode(conclusion, 'x')]).verdict,
      'declined',
      `conclusion ${JSON.stringify(conclusion)} must not read as a review`
    );
  }
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

test('a pass is not believed until the same contexts come back twice', async () => {
  // The defect this closes. Aikido creates `check code` 0-2s before
  // `Deep Review`, so a poll can land on a head carrying one completed
  // `success` and nothing outstanding. `classify` calls that `reviewed`, and
  // acting on the first one would exit 0 over a review that was still arriving
  // - the false pass this whole gate exists to remove. The second page is the
  // one the head actually settles on.
  const fetchImpl = stubFetch(
    page(1, [checkCode('success', 'ok')]),
    page(2, [checkCode('success', 'ok'), deepReview('skipped', NO_CREDITS)])
  );
  const result = await awaitReview('o/r', 'abc', 't', {
    fetchImpl,
    sleep: () => Promise.resolve(),
    now: clock(1000),
    deadlineMs: 60_000,
    intervalMs: 15_000,
  });

  assert.equal(result.verdict, 'declined');
  assert.equal(fetchImpl.calls.length, 2);
});

test('a pass seen either side of a running poll is two passes, not two in a row', async () => {
  // Why the confirmation is reset rather than only overwritten. A check that is
  // re-requested goes back to `in_progress` and then forward again under the
  // same name, so the set can read identically either side of a poll that saw
  // the head unsettled. That middle poll is positive evidence the head was
  // still moving, which is exactly what the first observation would otherwise
  // be vouching for. Consecutive is the property; "seen twice" is not.
  const fetchImpl = stubFetch(
    page(1, [checkCode('success', 'ok')]),
    page(1, [checkCode(null, undefined)]),
    page(1, [checkCode('success', 'ok')]),
    page(2, [checkCode('success', 'ok'), deepReview('skipped', NO_CREDITS)])
  );
  const result = await awaitReview('o/r', 'abc', 't', {
    fetchImpl,
    sleep: () => Promise.resolve(),
    now: clock(1000),
    deadlineMs: 120_000,
    intervalMs: 15_000,
  });

  assert.equal(result.verdict, 'declined');
  assert.equal(fetchImpl.calls.length, 4);
});

test('a growing set of contexts is not a settled one', async () => {
  // Why the confirmation is keyed on WHICH contexts came back and not merely on
  // having seen a pass twice. The gate matches on the app slug, not on two
  // known names, so any context Aikido adds is in scope - and a set that is
  // still growing at the second poll has not settled, whatever the second poll
  // happened to say. "Seen twice" would stop at page two here and report a pass
  // over a head whose third Aikido context declines on page three.
  const iac = run('Aikido Security: IaC', 'skipped', NO_CREDITS);
  const fetchImpl = stubFetch(
    page(1, [checkCode('success', 'ok')]),
    page(2, [checkCode('success', 'ok'), deepReview('success', 'No issues found.')]),
    page(3, [checkCode('success', 'ok'), deepReview('success', 'No issues found.'), iac])
  );
  const result = await awaitReview('o/r', 'abc', 't', {
    fetchImpl,
    sleep: () => Promise.resolve(),
    now: clock(1000),
    deadlineMs: 60_000,
    intervalMs: 15_000,
  });

  assert.equal(result.verdict, 'declined');
  assert.deepEqual(
    result.runs.map((entry) => entry.name),
    ['Aikido Security: IaC']
  );
});

test('a pass settles on the second look, not the tenth', async () => {
  // The confirmation is one extra poll and it is keyed on the set of contexts,
  // not on there being two of them: `check code` alone, twice, is a settled
  // pass. That is the shape #408 asks the owner for as an alternative to
  // credits - disable `Deep Review` - and it must not hang the gate to its
  // deadline waiting for a context nobody is going to post. The stub holds
  // exactly two pages, so a third fetch throws rather than quietly succeeding.
  const fetchImpl = stubFetch(
    page(1, [checkCode('success', 'ok')]),
    page(1, [checkCode('success', 'ok')])
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

  assert.equal(result.verdict, 'reviewed');
  assert.equal(fetchImpl.calls.length, 2);
  assert.deepEqual(slept, [15_000]);
});

test('docs/security-gates.md names the same verdict conclusions the code does', () => {
  // This drifted once already and nothing said so. #524 wrote the section
  // against a denylist of four conclusions; #526 replaced the code with an
  // allowlist of three and left the prose describing the list it had removed -
  // so the document that tells a reviewer what this gate passes named
  // `skipped`, `neutral`, `cancelled` and `stale` as the declining set, and was
  // silent on `action_required`, which is the member the fix was about.
  //
  // The doc is prose and cannot be generated, but the one sentence carrying the
  // list can be compared to the constant. Only the closed side is written down
  // there, which is also why this can be checked at all: the declining side is
  // open-ended by design and has no list to compare against.
  const docPath = path.join(import.meta.dirname, '..', '..', 'docs', 'security-gates.md');
  const doc = readFileSync(docPath, 'utf8');

  // A canary on the read itself: a section extracted from the wrong file, or
  // from a heading that has been renamed, must fail here rather than downstream
  // as an empty string that matches nothing.
  const section = /^## Aikido coverage$([\s\S]*?)^## /mu.exec(doc)?.[1];
  assert.ok(section, `no "## Aikido coverage" section in ${docPath}`);
  assert.ok(
    section.length > 500,
    `the Aikido coverage section read as ${String(section.length)} chars`
  );

  const listed = /reached a verdict - ((?:`[a-z_]+`(?:, )?)+)/u.exec(section)?.[1];
  assert.ok(listed, 'the Aikido coverage section no longer states which conclusions are a verdict');
  assert.deepEqual(
    listed
      .split(', ')
      .map((entry) => entry.replaceAll('`', ''))
      .sort(),
    [...REACHED_A_VERDICT].sort()
  );
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

// --- the bot-authored head exemption (#549) -------------------------------
//
// Aikido declines Deep Review on any head whose latest commit was authored by a
// bot. `Aikido Security: check code` runs there and is the required context, so
// the exemption is one context and one conclusion wide and the tests below are
// mostly about the edges of it rather than the middle.

const bot = { headAuthoredByBot: true };

test('a bot-authored head passes on check code alone, with Deep Review excused', () => {
  const result = classify(
    [checkCode('success', 'Aikido Security check OK.'), deepReview('skipped', BOT)],
    2,
    bot
  );
  assert.equal(result.verdict, 'reviewed');
  assert.deepEqual(
    result.runs.map((entry) => entry.name),
    ['Aikido Security: check code'],
    'the excused check is not counted as one that ran'
  );
  assert.deepEqual(
    result.exempt.map((entry) => entry.name),
    ['Aikido Security: Deep Review']
  );
});

test('the same head without the bot flag still declines, so the flag is what moves it', () => {
  // The two arms differ in one input. Without this, the arm above passes
  // equally well on a classify that stopped declining skips altogether.
  const runs = [checkCode('success', 'Aikido Security check OK.'), deepReview('skipped', BOT)];
  assert.equal(classify(runs, 2, bot).verdict, 'reviewed');
  assert.equal(classify(runs, 2).verdict, 'declined');
  assert.equal(classify(runs, 2, { headAuthoredByBot: false }).verdict, 'declined');
});

test('a skipped check code on a bot-authored head is still red, which is the whole point', () => {
  // GitHub satisfies a required status check on "a successful, skipped, or
  // neutral status", so a `check code` that reported `skipped` MERGES. This
  // gate is the only thing on the head that says otherwise, and the exemption
  // must not reach it. The wide form of #549's option (b) - not running the job
  // at all on a bot head - is what this test exists to refuse.
  const result = classify([checkCode('skipped', NO_CREDITS), deepReview('skipped', BOT)], 2, bot);
  assert.equal(result.verdict, 'declined');
  assert.deepEqual(
    result.runs.map((entry) => entry.name),
    ['Aikido Security: check code']
  );
});

test('a bot-authored head carrying only the excused check has not been scanned', () => {
  // `rest` is empty, and reading an empty declining set as a review is the
  // false pass one layer in. Reported as its own verdict so the message can say
  // which context is missing rather than that everything was fine.
  const result = classify([deepReview('skipped', BOT)], 1, bot);
  assert.equal(result.verdict, 'only-exempt');
  assert.match(describe(result, 'abc'), /check code/u);
  assert.match(describe(result, 'abc'), /nothing scanned it/u);
});

test('a bot-authored head with no Aikido check at all is absent, not excused', () => {
  assert.equal(classify([other('CI Required', 'success')], 1, bot).verdict, 'absent');
  assert.equal(classify([], 0, bot).verdict, 'no-checks');
});

test('the exemption is exactly one name and one conclusion, and widening either fails here', () => {
  // The anti-widening assertion, and it is a direct one because a widening is
  // invisible to every test that only makes legal calls: broadening the
  // predicate to all Aikido contexts, or to all non-verdict conclusions, leaves
  // every case above passing.
  assert.deepEqual(Object.keys(BOT_EXEMPT).sort(), ['conclusion', 'name']);
  assert.equal(BOT_EXEMPT.name, 'Aikido Security: Deep Review');
  assert.equal(BOT_EXEMPT.conclusion, 'skipped');
  assert.ok(Object.isFrozen(BOT_EXEMPT));

  assert.equal(isBotExempt(deepReview('skipped', BOT)), true);

  // Every neighbouring cell of the two-field grid is NOT exempt. The name axis
  // includes the other real context and the renamed-vendor case; the conclusion
  // axis includes every member of both published enums bar `skipped`.
  for (const name of ['Aikido Security: check code', 'Aikido Security: Deep review', 'x']) {
    assert.equal(isBotExempt(run(name, 'skipped', BOT)), false, `${name} must not be exempt`);
  }
  for (const conclusion of [
    'action_required',
    'cancelled',
    'failure',
    'neutral',
    'stale',
    'success',
    'timed_out',
    '',
    null,
  ]) {
    assert.equal(
      isBotExempt(deepReview(conclusion, BOT)),
      false,
      `Deep Review ${JSON.stringify(conclusion)} must not be exempt`
    );
  }
});

test('a bot-authored head still declines a Deep Review that did not skip', () => {
  // `action_required` on Deep Review is the wallet asking for a human. It is
  // not the bot rule and it is not excused, on a bot head or anywhere else.
  const result = classify(
    [checkCode('success', 'ok'), deepReview('action_required', 'Add credits to continue.')],
    2,
    bot
  );
  assert.equal(result.verdict, 'declined');
  assert.deepEqual(result.exempt, []);
});

test('the exemption is reported in the announcement rather than applied silently', () => {
  const message = describe(
    classify([checkCode('success', 'ok'), deepReview('skipped', BOT)], 2, bot),
    'abc123'
  );
  assert.match(message, /EXEMPT/u);
  assert.match(message, /bot-authored/u);
  // Dated, so the acceptance carries the day it was made into the log it prints.
  assert.match(message, /2026-09-22, #549/u);
});

test('the bot fact is read off the commit author, not the committer', async () => {
  // The two fields DISAGREE on exactly the head this exemption is about: a
  // dependabot commit is committed by GitHub's web-flow account, so
  // `.committer.type` is `User` while `.author.type` is `Bot`. Measured on
  // 2cbbf64, PR #546. A fixture where both fields agree cannot separate the two
  // readings, so each arm below sets them to opposite values.
  const commit = (author, committer) => ({
    body: { author: author && { type: author }, committer: committer && { type: committer } },
  });
  const read = async (page) => {
    const fetchImpl = stubFetch(page);
    const isBot = await headCommitIsBot('o/r', 'abc', 't', fetchImpl);
    assert.match(fetchImpl.calls[0].url, /\/repos\/o\/r\/commits\/abc$/u);
    return isBot;
  };

  assert.equal(await read(commit('Bot', 'User')), true, 'the real dependabot shape');
  assert.equal(await read(commit('User', 'Bot')), false, 'reading the committer would say true');
  // An unmatched author email resolves to null, and null is not a bot. The
  // fail-closed direction: an unrecognised head keeps the gate strict.
  assert.equal(await read(commit(null, 'Bot')), false);
  // And the comparison is on the exact string, not truthiness - the arm that
  // survived when the call site spelled it out instead of this function.
  assert.equal(await read(commit('bot', null)), false, 'case-variant is not a bot');
  assert.equal(await read(commit('Organization', null)), false);
});

test('the commit author decides the exemption, and the pull request author does not', async () => {
  // The case the review found, and the one that makes this the commit's author
  // rather than the pull request's: a human pushes onto a dependabot branch to
  // fix a lockfile conflict. The pull request author is still the bot; Aikido's
  // rule looks at the commit and does not fire; a Deep Review that skipped for
  // want of credits would be excused by a gate keyed on the wrong field.
  const head = [checkCode('success', 'ok'), deepReview('skipped', NO_CREDITS)];
  const verdictFor = async (authorType) => {
    const fetchImpl = stubFetch(page(2, head), page(2, head));
    const result = await awaitReview('o/r', 'abc', 't', {
      fetchImpl,
      sleep: () => Promise.resolve(),
      now: clock(1000),
      deadlineMs: 60_000,
      intervalMs: 15_000,
      headAuthoredByBot: authorType === 'Bot',
    });
    return result.verdict;
  };
  assert.equal(await verdictFor('Bot'), 'reviewed');
  assert.equal(await verdictFor('User'), 'declined', 'a hand-pushed commit is not excused');
  assert.equal(await verdictFor(null), 'declined', 'an unmatched author is not excused');
});

test('an unreadable commit is red rather than unexcused-by-default', async () => {
  // The gate cannot decide an exemption it could not read. Throwing fails the
  // job, which is the recoverable direction; returning null would quietly make
  // every bot head strict again and look like the exemption never landed.
  const fetchImpl = stubFetch({ ok: false, status: 404, body: {} });
  await assert.rejects(() => headCommitIsBot('o/r', 'abc', 't', fetchImpl), /returned 404/u);
});

test('docs/security-gates.md names the same exempt pair the code does', () => {
  // The verdict list in that document drifted once and nothing said so (#524 /
  // #526, see the test above). This is the same check for the exemption, which
  // is the other thing in the file a reader has to be able to trust from the
  // prose. It pins the DOCUMENT against the constant, not the constant - if
  // BOT_EXEMPT widens, the test above is what fails, and this one follows it.
  const docPath = path.join(import.meta.dirname, '..', '..', 'docs', 'security-gates.md');
  const doc = readFileSync(docPath, 'utf8');

  const section = /^### The bot-authored head exemption[^\n]*$([\s\S]*?)^## /mu.exec(doc)?.[1];
  assert.ok(section, `no bot-authored head exemption section in ${docPath}`);
  assert.ok(section.length > 500, `the exemption section read as ${String(section.length)} chars`);

  assert.ok(
    section.includes(`\`${BOT_EXEMPT.name}\` + \`${BOT_EXEMPT.conclusion}\``),
    'the section must name the exempt pair exactly as the code holds it'
  );
  // The other context is named as the one that stays required. A section that
  // stopped saying so would read as excusing the head.
  assert.ok(section.includes('`Aikido Security: check code`'));
  assert.match(section, /required/u);
});
