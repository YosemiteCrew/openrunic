import { expect, test } from '@playwright/test';

import {
  clinicalStep,
  expectToast,
  openNavigation,
  selectOptionByText,
  visit,
} from './support/drill.js';

/**
 * THE FULL CLINICAL DAY
 *
 * One patient, front door to front door: booked, checked in, roomed, charted,
 * ordered, resulted, charged, claimed, paid, checked out. This is the
 * acceptance test for the product. If it is green, a practice can get through a
 * day; if it is red, something in that sentence is not true.
 *
 * It runs against the web application in MOCK mode, so it needs no database and
 * no API, and can therefore gate every pull request rather than a nightly.
 *
 * TWO HONEST LIMITS OF MOCK MODE, both verified in the source rather than
 * assumed, and both of which shape what this file can assert:
 *
 *   1. Nothing persists. Every screen holds its writes in component state -
 *      the mock client says so in its own header ("a fixture that accepts
 *      writes teaches screens to trust state the server never saw"). So an
 *      appointment booked in step 1 is not visible in step 2, and the drill
 *      cannot be one continuous session. It is instead thirteen scenarios, each
 *      proving its own act against the fixtures, plus the two chains that DO
 *      survive within a single screen: the flow board (roomed -> in progress ->
 *      checked out) and the billing workbench (charges -> claim).
 *
 *   2. The audit trail is a static fixture. Signing a note in mock mode does
 *      not append an audit event, and there is no APPOINTMENT_BOOK, CHECK_IN or
 *      PAYMENT action in the enum at all. So step 13 asserts what is actually
 *      true and useful: that the compliance record renders, and that it carries
 *      the clinical actions the day is made of. It does NOT claim to prove the
 *      steps above wrote to it. Proving that needs the live API, and belongs in
 *      the integration suite against a seeded database.
 *
 * Both limits are properties of mock mode, not of the product. Written down
 * here because a test that quietly asserts less than its name promises is worse
 * than one that does not exist.
 */

/** Fixture anchors, quoted from apps/web/src/lib/api/mock/fixtures.ts. */
const DEMO_PATIENT_ID = '0192f1a0-0000-7000-8000-00000000p001';
const UNSIGNED_ENCOUNTER_ID = '0192f1a0-0000-7000-8000-00000000e001';

/**
 * `formatName` prefers the preferred name, so Testina renders as Tess
 * everywhere. Asserting on "Testina" would fail on a correct application.
 */
const PATIENT = 'Tess Patientsson';

/**
 * Known accessibility violations, with an owner and a reason.
 *
 * These are real findings, deliberately not failing the build yet because they
 * are shell-wide and pre-date this drill. They stay listed so they are visible
 * in every report; the goal is an empty list.
 */
const KNOWN_SHELL_ISSUES = [
  // The skip link and the mobile Menu button both sit outside any landmark.
  'region',
  // Measured, not assumed: the muted caption colour is #8c5e3c on the two card
  // backgrounds #efe3d5 and #ede4d3, giving 4.39:1 and 4.40:1 against the 4.5:1
  // that WCAG AA requires at 12.5px. It affects 32 elements on the schedule
  // alone - badges, provider roles, every `or-caption`.
  //
  // This is a design-token fix, not a per-screen one, and it belongs to
  // whoever owns the design system. It is listed rather than silenced: the axe
  // report attached to every run names it under `tolerated`, so the debt is
  // visible on each pull request instead of disappearing.
  'color-contrast',
];

test.describe('the full clinical day', () => {
  test('front desk books an appointment', async ({ page }, testInfo) => {
    const context = { page, testInfo };

    await clinicalStep('1. Book an appointment', context, async () => {
      await visit(context, '/schedule', 'Schedule', KNOWN_SHELL_ISSUES);

      await page.getByRole('button', { name: 'Find available' }).click();
      await expect(page.getByText('Next open 20-minute slots')).toBeVisible();

      // The slot times are computed from the frozen clock, so they are matched
      // by shape rather than hardcoded - a fixture clock change should not
      // rewrite this test.
      await page
        .getByRole('button', { name: /^Book \d\d:\d\d with/ })
        .first()
        .click();

      const dialog = page.getByRole('dialog', { name: 'Book appointment' });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Patient').selectOption({ label: 'Patientsson, Tess (OR-100482)' });
      await dialog.getByRole('button', { name: 'Book Tess' }).click();

      await expectToast(page, 'Appointment booked');
    });
  });

  test('front desk checks the patient in', async ({ page }, testInfo) => {
    const context = { page, testInfo };

    await clinicalStep('2. Check the patient in', context, async () => {
      await visit(context, '/schedule', 'Schedule (check-in)', KNOWN_SHELL_ISSUES);

      // Chosen by STATE, not by name. Only a booked appointment can be checked
      // in, and which fixture patient happens to hold one is not what this step
      // is about. Naming a patient here is how this test broke before: the
      // fixtures moved, the appointment it named became Fulfilled, and the step
      // sat waiting for a button the screen was right not to offer.
      const booked = page.getByRole('button', { name: /, Booked$/ }).first();
      const appointment = (await booked.getAttribute('aria-label')) ?? '';
      await booked.click();

      // "HH:MM to HH:MM, Given Family, Reason, Clinician, Booked"
      const patient = appointment.split(', ')[1] ?? '';
      const given = patient.split(' ')[0] ?? '';
      expect(given, `no patient name in "${appointment}"`).not.toBe('');

      const rail = page.getByRole('complementary', { name: 'Page context' });
      await rail.getByRole('button', { name: `Check in ${given}` }).click();

      // Asserts what the confirmation has to get right - whose visit this is,
      // and what confirming will do - rather than one exact sentence. The
      // wording here has already drifted once; naming the person and the
      // consequence is the part that would be a defect if it went missing.
      const confirm = page.getByRole('alertdialog', { name: 'Check in this patient' });
      await expect(confirm).toContainText(given);
      await expect(confirm).toContainText('Flow Board');
      await confirm.getByRole('button', { name: `Check in ${given}` }).click();

      await expectToast(page, 'Checked in');
    });
  });

  test('a medical assistant rooms the patient, and the day ends with check-out', async ({
    page,
  }, testInfo) => {
    const context = { page, testInfo };

    // Steps 3 and 12 share this test on purpose: the flow board's status
    // overrides survive within one visit, so rooming and checking out the same
    // patient is a genuine chain rather than two unrelated clicks.
    // Whoever the board offers, rather than a patient named here. The board
    // only shows "Move X to roomed" for someone who has arrived and is not yet
    // roomed, so taking the first one asks the question this step means: can an
    // arrived patient be roomed? A hard-coded name asks a question about the
    // fixtures instead, and answers it wrongly the moment they change.
    let given = '';

    await clinicalStep('3. Room the patient', context, async () => {
      await visit(context, '/schedule/flow-board', 'Flow board', KNOWN_SHELL_ISSUES);

      const toRoom = page.getByRole('button', { name: /^Move .+ to roomed$/ }).first();
      const label = (await toRoom.getAttribute('aria-label')) ?? '';
      given = label.replace(/^Move /, '').replace(/ to roomed$/, '');
      expect(given, 'the flow board offered nobody to room').not.toBe('');

      await toRoom.click();
      await expectToast(page, 'Roomed');

      // The select carries the full name where the button carries the given
      // one, so this matches on the prefix rather than assuming the two agree.
      await page
        .getByRole('combobox', { name: new RegExp(`^Room for ${given}\\b`) })
        .selectOption('Room 1');
      await expectToast(page, 'Room assigned');
    });

    await clinicalStep('12. Check the patient out', context, async () => {
      await page.getByRole('button', { name: `Move ${given} to in progress` }).click();
      await page.getByRole('button', { name: `Move ${given} to checked out` }).click();
      await expectToast(page, 'Checked out');
    });
  });

  test('the clinician opens the chart', async ({ page }, testInfo) => {
    const context = { page, testInfo };

    await clinicalStep('4. Open the patient chart', context, async () => {
      await visit(context, `/patients/${DEMO_PATIENT_ID}`, 'Patient chart', KNOWN_SHELL_ISSUES);

      await expect(page.getByRole('heading', { level: 1, name: PATIENT })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Summary' })).toBeVisible();

      // The counted tabs are the proof the chart actually loaded a chart, not
      // an empty shell that happens to render the patient's name.
      await page.getByRole('tab', { name: /^Results/ }).click();
      await expect(page.getByRole('tab', { name: /^Results/ })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    });
  });

  test('the clinician writes and signs a note', async ({ page }, testInfo) => {
    const context = { page, testInfo };

    await clinicalStep('5. Write and sign a clinical note', context, async () => {
      await visit(
        context,
        `/encounters/${UNSIGNED_ENCOUNTER_ID}`,
        'Encounter note',
        KNOWN_SHELL_ISSUES
      );

      await page
        .getByRole('textbox', { name: 'Subjective' })
        .fill('Patient reports the cough has settled. No fever since Friday.');
      await page
        .getByRole('textbox', { name: 'Assessment' })
        .fill('Resolving viral upper respiratory infection.');

      await page.getByRole('button', { name: 'Sign note' }).click();

      const confirm = page.getByRole('alertdialog', { name: 'Sign this note?' });
      await confirm.getByRole('button', { name: 'Sign note' }).click();

      // Signing locks the note: the editable fields must be gone, not merely
      // disabled, and the signature block must be present.
      await expect(page.getByText('Signed and locked')).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Subjective' })).toHaveCount(0);
      // "Signed by" appears in both the locked banner and the signature card.
      await expect(page.getByText('Signed by').first()).toBeVisible();
    });
  });

  test('the clinician places an order', async ({ page }, testInfo) => {
    const context = { page, testInfo };

    await clinicalStep('6. Place an order', context, async () => {
      await visit(context, '/orders/new', 'New order', KNOWN_SHELL_ISSUES);

      // The picker defaults to the first patient alphabetically, not to ours.
      await selectOptionByText(page, 'Ordering for', 'Patientsson, Tess');

      await page
        .getByRole('group', { name: 'Favourite orders' })
        .getByRole('button')
        .first()
        .click();

      // Two things stand between a drafted order and a signature, and both are
      // patient-safety features rather than obstacles, so the drill exercises
      // them instead of routing around them.
      //
      // First: an order with no diagnosis linked cannot be signed. The composer
      // says so in a blocker list rather than disabling the button silently.
      const diagnosis = page.getByLabel('Diagnosis this order justifies').first();
      await diagnosis.selectOption({ index: 1 });

      // Second: the first favourite is a duplicate of a lab already in
      // progress, which raises a CRITICAL warning. A duplicate inside 30 days
      // is not payable and delays the result, so signing it requires a recorded
      // override reason - exactly the interlock a clinician should meet.
      const override = page.getByRole('button', { name: 'Override and keep this order' });
      if ((await override.count()) > 0) {
        await page.getByLabel('Reason for overriding').selectOption({ index: 1 });
        await override.first().click();
      }

      // "Review and sign" only moves the composer to its review step. The
      // confirmation modal is opened by the sign button on that step, which is
      // labelled with the draft count ("Sign 1 order"); the same action also
      // exists in the page header, so this takes the later of the two.
      await page.getByRole('button', { name: 'Review and sign' }).click();
      await page
        .getByRole('button', { name: /^Sign \d+ order/ })
        .last()
        .click();

      const dialog = page.getByRole('dialog', { name: 'Sign these orders' });
      await dialog.getByRole('button', { name: 'Sign and transmit' }).click();

      await expectToast(page, /order.* signed/i);
    });
  });

  test('the clinician reviews and signs a result', async ({ page }, testInfo) => {
    const context = { page, testInfo };

    await clinicalStep('7. Review and sign a result', context, async () => {
      await visit(context, '/results', 'Results', KNOWN_SHELL_ISSUES);

      const queue = page.getByRole('list', { name: 'Results to review' });
      await expect(queue).toBeVisible();

      // Critical results sort first. That ordering is a patient-safety
      // property, so the drill asserts it rather than just signing something.
      await expect(queue.getByRole('listitem').first()).toContainText(/critical/i);

      await page.getByRole('button', { name: 'Sign Lipid panel' }).click();
      const dialog = page.getByRole('dialog', { name: 'Sign this result' });
      await dialog.getByRole('button', { name: 'Sign result' }).click();

      await expectToast(page, 'Lipid panel signed');
    });
  });

  test('the biller captures charges and submits the claim', async ({ page }, testInfo) => {
    const context = { page, testInfo };

    await clinicalStep('8. Capture charges', context, async () => {
      await visit(context, '/billing/charges', 'Charges', KNOWN_SHELL_ISSUES);

      // The fee sheet ships with an unjustified line, so "ready for billing"
      // starts disabled. Linking the diagnosis is the actual clinical work.
      const markReady = page.getByRole('button', { name: 'Mark ready for billing' });
      await expect(markReady).toBeDisabled();

      await page.getByRole('button', { name: 'Link I10 Essential hypertension to 93000' }).click();

      await expect(markReady).toBeEnabled();
      await markReady.click();

      const confirm = page.getByRole('alertdialog', { name: 'Mark ready for billing' });
      await confirm.getByRole('button', { name: 'Mark ready', exact: true }).click();

      await expectToast(page, 'Visit marked ready');
      await expect(page.getByText('Nothing blocks this visit from billing.')).toBeVisible();
    });

    await clinicalStep('9. Submit a claim', context, async () => {
      await visit(context, '/billing/claims', 'Claims', KNOWN_SHELL_ISSUES);

      // Bulk actions only exist once a state filter is chosen; without this the
      // submit button is genuinely absent rather than merely hidden.
      await page.getByRole('button', { name: /^Scrubbed/ }).click();
      // The checkbox input is `opacity: 0; pointer-events: none` - present for
      // assistive technology, unreachable by a pointer. Neither a click nor a
      // forced check toggles it: the browser will not deliver a pointer event
      // to an element that opts out of them. Dispatching the event directly
      // bypasses hit-testing, and React's onChange handler receives it.
      await page.getByRole('checkbox', { name: 'Select claim CLM-24112' }).dispatchEvent('click');
      await page.getByRole('button', { name: 'Submit selected claims' }).click();

      await expectToast(page, /claim submitted/i);
    });
  });

  test('the biller works a remittance and takes a payment', async ({ page }, testInfo) => {
    const context = { page, testInfo };

    await clinicalStep('10. Work the posted remittance', context, async () => {
      await visit(context, '/billing/remittance', 'Remittance', KNOWN_SHELL_ISSUES);

      // There is no "post a remittance" control anywhere, and that is by
      // design: remittances arrive through the clearinghouse adapter and post
      // themselves, so no file is ever handled on this screen. The human act
      // that remains - and the one worth testing - is dispositioning the
      // exception lines that auto-posting could not resolve.
      await expect(page.getByRole('heading', { name: /EFT-8841207/ })).toBeVisible();

      await page
        .getByRole('button', { name: 'Transferred to patient for CLM-24045 99213' })
        .click();

      await expectToast(page, 'The line left the exception queue.');
    });

    await clinicalStep('11. Take a payment', context, async () => {
      await visit(context, '/billing/payments', 'Payments', KNOWN_SHELL_ISSUES);

      // Accounts sort by balance, so the default selection is a patient with no
      // card on file and the button starts disabled. Selecting the patient must
      // come before the amount: choosing one resets the amount and allocations.
      await selectOptionByText(page, 'Patient', 'Patientsson, Tess');
      await page.getByLabel('Amount', { exact: true }).fill('38.00');
      await page.getByRole('button', { name: 'Allocate oldest first' }).click();
      await page.getByRole('button', { name: 'Take payment' }).click();

      await expectToast(page, /taken/);
      await expect(page.getByRole('dialog', { name: /^Receipt RCP-/ })).toBeVisible();
    });
  });

  test('the compliance record carries the day', async ({ page }, testInfo) => {
    const context = { page, testInfo };

    await clinicalStep('13. The audit trail', context, async () => {
      await visit(context, '/admin/audit', 'Audit', KNOWN_SHELL_ISSUES);

      const table = page.getByRole('table', { name: /Audit events/ });
      await expect(table).toBeVisible();

      // The clinical acts of the day, as the audit vocabulary names them. In
      // mock mode these come from the seeded compliance record rather than from
      // the steps above (see the header of this file); against the live API the
      // same assertions run on events the drill itself caused.
      for (const action of ['Note sign', 'Order sign', 'Claim submit', 'Patient read']) {
        await expect(table).toContainText(action);
      }

      // Break-glass access is the one event a compliance officer looks for
      // first, so its visibility is asserted, not assumed. Matched with a count
      // in front of it: a bare /breakglass/i also matches the hidden <option>
      // in the filter dropdown, which is present but never visible.
      await expect(page.getByText(/\d+ breakglass/i).first()).toBeVisible();
    });
  });
});

test.describe('the shell at every width', () => {
  test('navigation reaches the clinical screens', async ({ page }, testInfo) => {
    const context = { page, testInfo };

    await clinicalStep('Navigation', context, async () => {
      await visit(context, '/schedule', 'Schedule (navigation)', KNOWN_SHELL_ISSUES);

      // Below 1024 the rail is display:none until Menu is pressed, so this is
      // a different code path per project rather than the same one narrower.
      await openNavigation(page);

      for (const item of ['Schedule', 'Patients', 'Orders', 'Billing']) {
        await expect(page.getByRole('link', { name: item })).toBeVisible();
      }
    });
  });
});
