import type { Messages } from '../../catalogue.js';

/**
 * Charges, claims, remittance, statements and payments. Operational rather
 * than clinical: safe to translate.
 *
 * ## What is here and what is deliberately not
 *
 * The words this area invented are here: its own workflow states (a claim is
 * "captured", then "scrubbed"), its own ageing bands, its own dispositions for
 * an exception. Those are openrunic's vocabulary for its own screens, so they
 * are ours to name in every language.
 *
 * What is not here is anything that already carries a name from a code system
 * or from a payer: a CPT description, an ICD-10 display, a denial reason off an
 * 835, a payer's own name for itself. Those arrive as data and render as data.
 * Putting a translated label on a coded value gives the code a second, diverging
 * name, and the biller reading it has no way to tell which one the payer will
 * recognise.
 *
 * ## Counts
 *
 * A count that reads inside a sentence carries its own singular and plural key
 * rather than being assembled from a number and a noun. English gets away with
 * "1 claim"/"2 claims"; the sentence "1 error blocks billing" needs the verb to
 * move as well, and other languages need more than the two forms. Both keys are
 * literals so the drift test can see them.
 */
export const billing: Messages = {
  /* --------------------------------------------------------- shared surface */
  'billing.drawer.close': 'Close',

  /* ------------------------------------------------------------------ money */

  /*
   * What a negative amount means, and how it is spoken.
   *
   * Two keys per meaning rather than one lowercased into the other. "Credit" is
   * the word printed beside the number and "credit" is the word inside the
   * sentence a screen reader hears, and in English the only difference is a
   * capital. That is a fact about English: German capitalises the noun in both
   * places, and a language that reorders the sentence needs to move the whole
   * thing rather than a fragment.
   *
   * `{amount}` arrives already formatted by `Intl` with `currencyDisplay: 'name'`
   * ("38.00 US dollars"), so the currency is named in the reader's language by
   * the runtime and this message only decides where it sits in the sentence.
   */
  'billing.money.credit': 'Credit',
  'billing.money.refund': 'Refund',
  'billing.money.spokenCredit': '{amount} credit',
  'billing.money.spokenRefund': '{amount} refund',

  /* ------------------------------------------------ claim states and ageing */
  /* openrunic's own claim workflow, not an X12 vocabulary. */
  'billing.claimStatus.captured': 'Captured',
  'billing.claimStatus.scrubbed': 'Scrubbed',
  'billing.claimStatus.submitted': 'Submitted',
  'billing.claimStatus.acknowledged': 'Acknowledged',
  'billing.claimStatus.paid': 'Paid',
  'billing.claimStatus.denied': 'Denied',
  'billing.claimStatus.rebilled': 'Rebilled',

  'billing.claimAge.onTrack': 'On track',
  'billing.claimAge.ageing': 'Ageing',
  'billing.claimAge.over30': 'Over 30 days',
  'billing.claimAge.over60': 'Over 60 days',

  'billing.ageingBand.fresh': '0 to 13 days',
  'billing.ageingBand.ageing': '14 to 29 days',
  'billing.ageingBand.late': '30 to 59 days',
  'billing.ageingBand.stale': '60 days and over',

  /* The verb and its object, per the voice rules. Also the palette's label for
     the same action, so the button and the command cannot drift apart. */
  'billing.bulkAction.scrub': 'Scrub selected claims',
  'billing.bulkAction.submit': 'Submit selected claims',
  'billing.bulkAction.rebill': 'Correct and rebill selected claims',

  /* ------------------------------------------------------------- remittance */
  'billing.variance.matched': 'Matched',
  'billing.variance.underpaid': 'Underpaid',
  'billing.variance.overpaid': 'Overpaid',

  'billing.resolution.accepted': 'Accepted as paid',
  'billing.resolution.adjusted': 'Adjusted off',
  'billing.resolution.transferred': 'Transferred to patient',
  'billing.resolution.flagged': 'Flagged for appeal',

  /* ------------------------------------------------------ statements and AR */
  'billing.bucket.current': '0 to 30 days',
  'billing.bucket.days3160': '31 to 60 days',
  'billing.bucket.days6190': '61 to 90 days',
  'billing.bucket.days91Plus': '91 days and over',

  'billing.bucketState.onTrack': 'On track',
  'billing.bucketState.ageing': 'Ageing',
  'billing.bucketState.chase': 'Chase these',

  'billing.dunning.none': 'No statement sent',
  'billing.dunning.firstNotice': 'First notice',
  'billing.dunning.secondNotice': 'Second notice',
  'billing.dunning.finalNotice': 'Final notice',
  'billing.dunning.collections': 'With collections',

  /* --------------------------------------------------------- allocation ---- */
  'billing.allocationState.over': 'Over-allocated',
  'billing.allocationState.balanced': 'Fully allocated',
  'billing.allocationState.short': 'Still to allocate',

  'billing.allocationHint.over': 'More is allocated than is being taken.',
  'billing.allocationHint.balanced': 'Every amount is applied to a visit.',
  'billing.allocationHint.short': 'Allocate the whole payment before taking it.',

  'billing.allocation.caption': 'Open visits',
  'billing.allocation.column.visit': 'Visit',
  'billing.allocation.column.description': 'Description',
  'billing.allocation.column.outstanding': 'Outstanding',
  'billing.allocation.column.allocated': 'Allocated',
  'billing.allocation.amountFor': 'Amount allocated to the visit on {date}',

  /* --------------------------------------------------------- scrub findings */
  /* The sentences the fee sheet's scrubber produces. Held as keys on the
     finding rather than as text, because `scrubFeeSheet` is a pure module with
     no translator and the words belong to whoever is reading the panel. */
  'billing.scrub.finding.noCharges':
    'No charges captured. Add at least one code before marking this visit ready.',
  'billing.scrub.finding.unjustified':
    '{code} has no diagnosis linked. Link one from the visit diagnoses.',
  'billing.scrub.finding.duplicate':
    '{code} appears more than once without a modifier. Add 59 or merge the lines.',
  'billing.scrub.finding.copay':
    'Copay of {amount} is not collected. Take it at checkout or bill it to the patient.',

  'billing.scrub.overline': 'Scrub',
  'billing.scrub.title': 'Before billing',
  'billing.scrub.clear': 'Nothing blocks this visit from billing.',
  'billing.scrub.blocking.one': '{count} error blocks billing.',
  'billing.scrub.blocking.other': '{count} errors block billing.',
  'billing.scrub.advisory': '{count} to review.',
  'billing.scrub.severity.blocking': 'Blocks billing',
  'billing.scrub.severity.advisory': 'Review',

  /* ------------------------------------------------------- visit diagnoses */
  'billing.diagnoses.overline': 'Visit diagnoses',
  'billing.diagnoses.title': 'Justify sources',
  'billing.diagnoses.hint':
    'Link a diagnosis to a charge with its letter on the line. A charge with no diagnosis cannot be billed.',
  'billing.diagnoses.notLinked': 'Not linked',
  'billing.diagnoses.chargeCount.one': '{count} charge',
  'billing.diagnoses.chargeCount.other': '{count} charges',

  /* ----------------------------------------------------------- charge lines */
  'billing.chargeLines.caption': 'Charge lines',
  'billing.chargeLines.column.code': 'Code',
  'billing.chargeLines.column.description': 'Description',
  'billing.chargeLines.column.modifier': 'Modifier',
  'billing.chargeLines.column.units': 'Units',
  'billing.chargeLines.column.fee': 'Fee',
  'billing.chargeLines.column.justify': 'Justified by',
  'billing.chargeLines.column.actions': 'Actions',
  'billing.chargeLines.removed': 'Removed',
  'billing.chargeLines.notJustified': 'Not justified',
  'billing.chargeLines.noModifier': 'None',
  'billing.chargeLines.link': 'Link {code} {display} to {line}',
  'billing.chargeLines.unlink': 'Unlink {code} {display} from {line}',
  'billing.chargeLines.modifierFor': 'Modifier for {code}',
  'billing.chargeLines.unitsFor': 'Units for {code}',
  'billing.chargeLines.restore': 'Restore',
  'billing.chargeLines.restoreCode': 'Restore {code}',
  'billing.chargeLines.removeCode': 'Remove {code}',

  /* ---------------------------------------------------------- charge picker */
  'billing.chargePicker.overline': 'Add charges',
  'billing.chargePicker.title': 'Codes',
  'billing.chargePicker.searchLabel': 'Search CPT and HCPCS',
  'billing.chargePicker.searchPlaceholder': 'Code or description',
  'billing.chargePicker.noMatch':
    'No code matches "{query}". Try the code number or a shorter word.',
  'billing.chargePicker.add': 'Add {code}, {display}',

  /* ------------------------------------------------------------ claim table */
  'billing.claimTable.caption': 'Claims',
  'billing.claimTable.column.select': 'Select',
  'billing.claimTable.column.claim': 'Claim',
  'billing.claimTable.column.patient': 'Patient',
  'billing.claimTable.column.serviceDate': 'Date of service',
  'billing.claimTable.column.payer': 'Payer',
  'billing.claimTable.column.billed': 'Billed',
  'billing.claimTable.column.status': 'State',
  'billing.claimTable.column.age': 'Age in state',
  'billing.claimTable.column.actions': 'Actions',
  'billing.claimTable.select': 'Select claim {number}',
  'billing.claimTable.open': 'Open',
  'billing.claimTable.openClaim': 'Open claim {number}',
  'billing.claimTable.scrubErrors.one': '{count} scrub error',
  'billing.claimTable.scrubErrors.other': '{count} scrub errors',
  'billing.claimTable.ageDays': '{days} d',

  /* ----------------------------------------------------------- claim drawer */
  'billing.claimDrawer.title': 'Claim {number}',
  'billing.claimDrawer.payerSeen': '{payer}, seen {date}',
  'billing.claimDrawer.totals.billed': 'Billed',
  'billing.claimDrawer.totals.paid': 'Paid',
  'billing.claimDrawer.totals.responsibility': 'Patient responsibility',
  'billing.claimDrawer.denial.overline': 'Denial',
  /* Only when the payer sent no denial code of its own. */
  'billing.claimDrawer.denial.untitled': 'Denied',
  'billing.claimDrawer.scrub.overline': 'Scrub',
  'billing.claimDrawer.scrub.title': 'Fix before submitting',
  'billing.claimDrawer.scrub.fix': 'Fix on the fee sheet',
  'billing.claimDrawer.lifecycle': 'Lifecycle',
  'billing.claimDrawer.step.done': 'Done',
  'billing.claimDrawer.step.pending': 'Pending',
  'billing.claimDrawer.events': 'Event history',
  'billing.claimDrawer.serviceLines': 'Service lines',
  'billing.claimDrawer.line.code': 'Code',
  'billing.claimDrawer.line.description': 'Description',
  'billing.claimDrawer.line.units': 'Units',
  'billing.claimDrawer.line.billed': 'Billed',
  'billing.claimDrawer.line.allowed': 'Allowed',
  'billing.claimDrawer.line.paid': 'Paid',
  'billing.claimDrawer.line.responsibility': 'Patient responsibility',
  'billing.claimDrawer.rebill': 'Correct and rebill',
  'billing.claimDrawer.rebillConfirm':
    'Correct and rebill {number} to {payer}. The original stays on the record and the replacement links back to it.',
  'billing.claimDrawer.cancel': 'Cancel',
  'billing.claimDrawer.rebillAction': 'Rebill claim',

  /* ---------------------------------------------------------------- receipt */
  'billing.receipt.title': 'Receipt {number}',
  'billing.receipt.caption': 'What this payment paid',
  'billing.receipt.column.visit': 'Visit',
  'billing.receipt.column.description': 'Description',
  'billing.receipt.column.applied': 'Applied',
  'billing.receipt.print': 'Print receipt',
  'billing.receipt.email': 'Email receipt',
  'billing.receipt.amount': 'Amount',
  'billing.receipt.method': 'Method',
  'billing.receipt.taken': 'Taken',
  'billing.receipt.takenAtBy': '{at} by {by}',
  'billing.receipt.reversed': 'Reversed, this receipt no longer applies',
  'billing.receipt.captured': 'Captured',

  /* ------------------------------------------------------- remittance lines */
  'billing.remittanceLines.column.claim': 'Claim',
  'billing.remittanceLines.column.patient': 'Patient',
  'billing.remittanceLines.column.code': 'Code',
  'billing.remittanceLines.column.billed': 'Billed',
  'billing.remittanceLines.column.allowed': 'Allowed',
  'billing.remittanceLines.column.paid': 'Paid',
  'billing.remittanceLines.column.adjustment': 'Adjustment',
  'billing.remittanceLines.column.responsibility': 'Patient responsibility',
  'billing.remittanceLines.column.variance': 'Variance',
  'billing.remittanceLines.column.resolve': 'Resolve',
  'billing.remittanceLines.cascades': 'Cascades to {payer}',
  'billing.remittanceLines.resolveFor': '{resolution} for {claim} {code}',

  /* ------------------------------------------------------- statement drawer */
  'billing.statementDrawer.title': 'Statement for {name}',
  'billing.statementDrawer.subtitle': '{stage}, {sent} sent',
  'billing.statementDrawer.sendLink': 'Send text-to-pay link',
  'billing.statementDrawer.linkSent': 'Link sent',
  'billing.statementDrawer.send': 'Send statement',
  'billing.statementDrawer.sentence': 'Your insurance paid {insurance}. Your share is {share}.',
  'billing.statementDrawer.linesCaption': 'Statement lines',
  'billing.statementDrawer.ledger.visit': 'Visit',
  'billing.statementDrawer.ledger.description': 'Description',
  'billing.statementDrawer.ledger.charges': 'Charges',
  'billing.statementDrawer.ledger.insurancePaid': 'Insurance paid',
  'billing.statementDrawer.ledger.adjustments': 'Adjustments',
  'billing.statementDrawer.ledger.outstanding': 'Your share',
  'billing.statementDrawer.totals.charges': 'Charges',
  'billing.statementDrawer.totals.insurancePaid': 'Insurance paid',
  'billing.statementDrawer.totals.balanceDue': 'Balance due',
  'billing.statementDrawer.collection': 'How this can be paid',
  'billing.statementDrawer.mobile': 'Mobile',
  'billing.statementDrawer.cardOnFile': 'Card on file',
  'billing.statementDrawer.cardConsent': 'Consent on record, card may be charged',
  'billing.statementDrawer.noCard': 'No card on file',
  'billing.statementDrawer.paymentPlan': 'Payment plan',
  'billing.statementDrawer.plan': '{amount} a month, {paid} of {total} paid',
  'billing.statementDrawer.noPlan': 'No plan',
  'billing.statementDrawer.lastStatement': 'Last statement',
  'billing.statementDrawer.noneSent': 'None sent',
  'billing.statementDrawer.runTitle': 'Statement run',
  'billing.statementDrawer.runSubtitle': '{count} accounts, {total} in total',
  'billing.statementDrawer.runBody':
    'Each account moves to the dunning stage shown. Accounts with a mobile number receive a text-to-pay link alongside the statement; the rest are printed.',
  'billing.statementDrawer.runCaption': 'Accounts in this run',
  'billing.statementDrawer.cancel': 'Cancel',
  'billing.statementDrawer.sendCount': 'Send {count} statements',
  'billing.statementDrawer.escalatesTo': 'to',
  'billing.statementDrawer.run.patient': 'Patient',
  'billing.statementDrawer.run.balance': 'Balance',
  'billing.statementDrawer.run.bucket': 'Oldest balance',
  'billing.statementDrawer.run.escalation': 'Dunning stage',
  'billing.statementDrawer.run.delivery': 'Delivery',
  'billing.statementDrawer.delivery.portalAndText': 'Portal and text',
  'billing.statementDrawer.delivery.print': 'Print',

  /* ------------------------------------------------------ the area's landing */
  'billing.home.title': 'Billing',
  'billing.home.description': 'Where the money is today, and the workbench that moves it.',
  'billing.home.strip': "Today's revenue cycle",
  'billing.home.readyToSubmit': 'Ready to submit',
  'billing.home.waitingOnSubmit': 'Waiting on a submit',
  'billing.home.nothingWaiting': 'Nothing waiting',
  'billing.home.denied': 'Denied',
  'billing.home.deniedClaims.one': '{count} claim',
  'billing.home.deniedClaims.other': '{count} claims',
  'billing.home.exceptions': 'Remittance exceptions',
  'billing.home.needsDecision': 'Needs a decision',
  'billing.home.allPosted': 'All posted',
  'billing.home.patientAr': 'Patient AR',
  'billing.home.someOver90': 'Some of it is over 90 days',
  'billing.home.accountCount': '{count} accounts',
  'billing.home.workbenches': 'Workbenches',
  'billing.home.whereToGo': 'Where to go',
  'billing.home.open': 'Open',
  'billing.home.oldestMoney': 'Oldest money',
  'billing.home.agedBalances': 'Aged balances',
  /* The amount is rendered before this by the Money component, which speaks the
     figure properly for a screen reader. The sentence therefore has to read
     with the money first in every language it is written in. */
  'billing.home.agedSentence': 'is over 90 days old across {count} accounts.',
  'billing.home.workTheseFirst': 'Work these first',
  'billing.home.nothingAged': 'Nothing aged',
  'billing.home.openStatements': 'Open statements and AR',
  'billing.home.area.charges.title': 'Fee sheet',
  'billing.home.area.charges.description':
    "Capture a visit's charges and link each one to its diagnosis.",
  'billing.home.area.claims.title': 'Claim workbench',
  'billing.home.area.claims.description':
    'Scrub, submit and work denials across every claim state.',
  'billing.home.area.remittance.title': 'Remittance',
  'billing.home.area.remittance.description': 'Post the 835s and clear what did not match.',
  'billing.home.area.statements.title': 'Statements and AR',
  'billing.home.area.statements.description': 'Patient balances, ageing and statement runs.',
  'billing.home.area.payments.title': 'Payments',
  'billing.home.area.payments.description': 'Take a payment, allocate it, issue the receipt.',

  /* ------------------------------------------------------------- fee sheet */
  'billing.charges.title': 'Fee sheet',
  'billing.charges.description':
    "Capture this visit's charges and link each one to the diagnosis paying for it.",
  'billing.charges.visitSelect': 'Visit',
  'billing.charges.markReady': 'Mark ready for billing',
  'billing.charges.hint.ready': 'This visit is in the claim pipeline.',
  'billing.charges.hint.clean': 'Charges are clean.',
  'billing.charges.hint.blocking.one': '{count} error blocks billing. See the scrub panel.',
  'billing.charges.hint.blocking.other': '{count} errors block billing. See the scrub panel.',
  'billing.charges.visit': 'Visit',
  'billing.charges.copay.none': 'No copay due',
  'billing.charges.copay.collected': 'Copay collected {amount}',
  'billing.charges.copay.outstanding': 'Copay outstanding {amount}',
  'billing.charges.readyBadge': 'Ready for billing',
  'billing.charges.totals.charges': 'Charges',
  'billing.charges.totals.copayCollected': 'Copay collected',
  'billing.charges.totals.expectedFromPayer': 'Expected from payer',
  'billing.charges.subject': "today's fee sheets",
  'billing.charges.empty.title': 'No visits to charge',
  'billing.charges.empty.message':
    'Charges appear here once a visit is checked in. Open the schedule to see today.',
  'billing.charges.empty.action': 'Go to the schedule',
  'billing.charges.confirm.description':
    '{count} charges lock and a claim is created for {name}. Charges can still be corrected from the claim.',
  'billing.charges.confirm.cancel': 'Cancel',
  'billing.charges.confirm.submit': 'Mark ready',
  'billing.charges.toast.added': '{code} added',
  'billing.charges.toast.addedMessage': 'Link a diagnosis to it.',
  'billing.charges.toast.removed': 'Charge removed',
  'billing.charges.toast.removedMessage':
    'It stays on the sheet, struck through, and can be restored.',
  'billing.charges.toast.restored': 'Charge restored',
  'billing.charges.toast.markedReady': 'Visit marked ready',
  'billing.charges.toast.markedReadyMessage': 'A claim was created from {count} charges.',
  'billing.charges.command.add': 'Add charge',
  'billing.charges.command.add.keywords': 'cpt, code, procedure, fee sheet',
  'billing.charges.command.markReady': 'Mark visit ready for billing',
  'billing.charges.command.markReady.keywords': 'ready, bill, close charges, submit charges',
  'billing.charges.command.nextVisit': "Open the next visit's fee sheet",
  'billing.charges.command.nextVisit.keywords': 'next visit, switch visit',

  /* ------------------------------------------------------- claim workbench */
  'billing.claims.title': 'Claim workbench',
  'billing.claims.description': 'Every claim as a state ledger row, from captured to paid.',
  'billing.claims.search': 'Search claims',
  'billing.claims.searchPlaceholder': 'Claim number, patient or MRN',
  'billing.claims.selectPrompt': 'Select claims to act on them.',
  'billing.claims.selectedCount': '{count} selected.',
  'billing.claims.strip': 'Claims by age in state',
  'billing.claims.bandState.one': '{count} claim, {advice}',
  'billing.claims.bandState.other': '{count} claims, {advice}',
  'billing.claims.advice.chase': 'chase these',
  'billing.claims.advice.ageing': 'ageing',
  'billing.claims.advice.onTrack': 'on track',
  'billing.claims.states': 'States',
  'billing.claims.filterTitle': 'Filter the queue',
  'billing.claims.stateLegend': 'Claim state',
  'billing.claims.all': 'All',
  'billing.claims.subject': 'the claim queue',
  'billing.claims.empty.filtered': 'No {state} claims',
  'billing.claims.empty.title': 'No claims',
  'billing.claims.empty.search':
    'Nothing in this queue matches "{query}". Clear the search to see the whole queue.',
  'billing.claims.empty.message':
    'Claims appear here once a visit is marked ready on the fee sheet.',
  'billing.claims.empty.action': 'Go to the fee sheet',
  'billing.claims.toast.nothingSelected': 'Nothing selected',
  'billing.claims.toast.nothingSelectedMessage': 'Select the claims to act on first.',
  'billing.claims.toast.bulkDone.one': '{count} claim {state}',
  'billing.claims.toast.bulkDone.other': '{count} claims {state}',
  'billing.claims.toast.movedTo': 'Moved to {state}.',
  'billing.claims.toast.rebilled': '{number} rebilled',
  'billing.claims.toast.rebilledMessage': 'A replacement claim went to {payer}.',
  'billing.claims.command.scrub.keywords': 'scrub, edits, check claims',
  'billing.claims.command.submit.keywords': 'submit, transmit, send claims, 837',
  'billing.claims.command.selectAll': 'Select every claim in this view',
  'billing.claims.command.selectAll.keywords': 'select all, bulk',
  'billing.claims.command.denied': 'Show denied claims',
  'billing.claims.command.denied.keywords': 'denials, denied, rejections',

  /* ---------------------------------------------------- remittance workbench */
  'billing.remittance.title': 'Remittance',
  'billing.remittance.description': 'Post the 835s, then work only what did not match.',
  'billing.remittance.exceptionsOnly': 'Exceptions only',
  'billing.remittance.listOverline': 'Remittances',
  'billing.remittance.listTitle': 'Received',
  'billing.remittance.exceptionCount.one': '{count} exception',
  'billing.remittance.exceptionCount.other': '{count} exceptions',
  'billing.remittance.postedInFull': 'Posted in full',
  'billing.remittance.subject': 'remittances',
  'billing.remittance.empty.title': 'No remittance advice received',
  'billing.remittance.empty.message':
    'Payer remittances arrive through the clearinghouse adapter and post themselves. Nothing has come in yet.',
  'billing.remittance.empty.action': 'Go to the claim workbench',
  'billing.remittance.cardTitle': 'Remittance {reference}',
  'billing.remittance.method.eft': 'Electronic transfer',
  'billing.remittance.method.check': 'Paper check',
  'billing.remittance.received': 'Received {date}',
  'billing.remittance.summary': 'Posting summary',
  'billing.remittance.payment': 'Payment',
  'billing.remittance.serviceLineCount': '{count} service lines',
  'billing.remittance.autoPosted': 'Auto-posted',
  'billing.remittance.autoPostedOf': '{posted} of {total} lines',
  'billing.remittance.exceptions': 'Exceptions',
  'billing.remittance.needsDecision': 'Needs a decision',
  'billing.remittance.nothingToWork': 'Nothing to work',
  'billing.remittance.patientResponsibility': 'Patient responsibility',
  'billing.remittance.movesToStatements': 'Moves to statements',
  'billing.remittance.workQueue': 'Work queue',
  'billing.remittance.exceptionsHint':
    'These lines did not pay what the claim expected. Choose what happens to each balance.',
  'billing.remittance.exceptionCaption': 'Exception queue',
  'billing.remittance.allMatched': 'Every line on {reference} matched the claim and posted itself.',
  'billing.remittance.ledger': 'Ledger',
  'billing.remittance.ledgerTitle': 'All service lines',
  'billing.remittance.ledgerCaption': 'Service lines on {reference}',
  'billing.remittance.toast.resolvedMessage': 'The line left the exception queue.',
  'billing.remittance.toast.noOther': 'No other remittance has exceptions',
  'billing.remittance.toast.noOtherMessage': 'Everything else posted in full.',
  'billing.remittance.command.exceptions': 'Open the next remittance with exceptions',
  'billing.remittance.command.exceptions.keywords': 'era, 835, exceptions, work queue',
  'billing.remittance.command.filterExceptions': 'Show only remittances with exceptions',
  'billing.remittance.command.filterExceptions.keywords': 'filter, era, exceptions',
  'billing.remittance.command.showAll': 'Show every remittance',
  'billing.remittance.command.showAll.keywords': 'clear filter, all era',

  /* ------------------------------------------------------- statements and AR */
  'billing.statements.title': 'Statements and AR',
  'billing.statements.description': 'Patient balances, how old they are, and how to collect them.',
  'billing.statements.search': 'Search balances',
  'billing.statements.searchPlaceholder': 'Patient or MRN',
  'billing.statements.previewRun': 'Preview statement run',
  'billing.statements.selectPrompt': 'Select accounts to run statements for.',
  'billing.statements.selectedCount': '{count} selected.',
  'billing.statements.strip': 'Accounts receivable by age',
  'billing.statements.ageing': 'Ageing',
  'billing.statements.filterTitle': 'Filter by bucket',
  'billing.statements.bucketLegend': 'Ageing bucket',
  'billing.statements.all': 'All',
  'billing.statements.caption': 'Patient balances',
  'billing.statements.column.select': 'Select',
  'billing.statements.column.patient': 'Patient',
  'billing.statements.column.balance': 'Balance',
  'billing.statements.column.bucket': 'Oldest balance',
  'billing.statements.column.statements': 'Statements',
  'billing.statements.column.lastPayment': 'Last payment',
  'billing.statements.column.dunning': 'Dunning stage',
  'billing.statements.column.actions': 'Actions',
  'billing.statements.select': 'Select {name}',
  'billing.statements.plan': 'Plan {paid} of {total}',
  'billing.statements.noneRecorded': 'None recorded',
  'billing.statements.preview': 'Preview',
  'billing.statements.previewFor': 'Preview statement for {name}',
  'billing.statements.subject': 'patient balances',
  'billing.statements.empty.filtered': 'No balances in {bucket}',
  'billing.statements.empty.title': 'No balances',
  'billing.statements.empty.message':
    'Patient responsibility arrives here from remittance advice. Nothing is outstanding in this view.',
  'billing.statements.empty.action': 'Go to remittance',
  'billing.statements.toast.nothingSelected': 'Nothing selected',
  'billing.statements.toast.nothingSelectedMessage': 'Select the accounts to include in this run.',
  'billing.statements.toast.sent.one': '{count} statement sent',
  'billing.statements.toast.sent.other': '{count} statements sent',
  'billing.statements.toast.sentMessage':
    'Accounts with a mobile number also received a payment link.',
  'billing.statements.toast.linkSent': 'Payment link sent',
  'billing.statements.toast.linkSentMessage': '{name} can pay from the link on their phone.',
  'billing.statements.command.run': 'Preview a statement run',
  'billing.statements.command.run.keywords': 'statements, run, send, dunning',
  'billing.statements.command.selectAll': 'Select every account in this view',
  'billing.statements.command.selectAll.keywords': 'select all, bulk',
  'billing.statements.command.over90': 'Show balances over 90 days',
  'billing.statements.command.over90.keywords': 'aging, ageing, collections, 90',
  'billing.statements.command.all': 'Show every balance',
  'billing.statements.command.all.keywords': 'clear filter, all balances',

  /* ----------------------------------------------------------- payments desk */
  'billing.payments.title': 'Payments',
  'billing.payments.description':
    'Take a payment, apply it to the visits it pays for, and issue the receipt.',
  'billing.payments.take': 'Take payment',
  'billing.payments.noCardHint': 'This patient has no card on file. Choose another method.',
  'billing.payments.recentOverline': 'Payments',
  'billing.payments.recentTitle': 'Recent',
  'billing.payments.recentSubject': 'recent payments',
  'billing.payments.recent.empty.title': 'No payments yet',
  'billing.payments.recent.empty.message':
    'Payments taken at the desk appear here with their receipts.',
  'billing.payments.reversed': 'Reversed',
  'billing.payments.method.overline': 'Method',
  'billing.payments.method.title': 'How it is being paid',
  'billing.payments.method.legend': 'Payment method',
  'billing.payments.method.cardOnFile': 'Card on file',
  'billing.payments.method.cardOnFileHint':
    'Charges the card the patient has already consented to.',
  'billing.payments.method.cardManual': 'Card keyed at the desk',
  'billing.payments.method.cardManualHint': 'One-off card, nothing stored.',
  'billing.payments.method.cash': 'Cash',
  'billing.payments.method.cashHint': 'Counted into the drawer.',
  'billing.payments.method.check': 'Check',
  'billing.payments.method.checkHint': 'Record the check number on the receipt.',
  /* Only reachable if the method list is ever emptied; the receipt still has to
     say what the money was. */
  'billing.payments.method.unknown': 'Payment',
  'billing.payments.checkNumber': 'Check number',
  'billing.payments.checkReference': 'Check {reference}',
  'billing.payments.noCardAlert':
    '{name} has no card on file. Key the card at the desk, or take cash or a check.',
  'billing.payments.subject': 'patient balances',
  'billing.payments.empty.title': 'No balances to collect',
  'billing.payments.empty.message':
    'Nothing is outstanding. A copay taken at check-in appears here on the day.',
  'billing.payments.empty.action': 'Go to the schedule',
  'billing.payments.payer': 'Payer',
  'billing.payments.whoIsPaying': 'Who is paying',
  'billing.payments.patient': 'Patient',
  'billing.payments.amount': 'Amount',
  'billing.payments.balance': 'Balance {amount}',
  'billing.payments.cardOnFileBadge': 'Card on file, consent on record',
  'billing.payments.noCardBadge': 'No card on file',
  'billing.payments.allocationOverline': 'Allocation',
  'billing.payments.allocationTitle': 'Which visits this pays',
  'billing.payments.unallocated': 'Unallocated',
  'billing.payments.allocateOldest': 'Allocate oldest first',
  'billing.payments.clearAllocation': 'Clear allocation',
  'billing.payments.noOpenVisits':
    '{name} has no open visits. Take the payment as a credit from the statements screen.',
  'billing.payments.toast.taken': '{amount} taken',
  'billing.payments.toast.takenMessage': 'Receipt {number} is ready to print or email.',
  'billing.payments.toast.printed': 'Receipt sent to the printer',
  'billing.payments.toast.emailed': 'Receipt emailed',
  'billing.payments.toast.receiptRef': 'Receipt {number}.',
  'billing.payments.command.amount': 'Take a payment',
  'billing.payments.command.amount.keywords': 'collect, copay, card, cash, check',
  'billing.payments.command.allocate': 'Allocate this payment oldest visit first',
  'billing.payments.command.allocate.keywords': 'allocate, apply, remainder, split',
  'billing.payments.command.receipt': 'Open the last receipt',
  'billing.payments.command.receipt.keywords': 'receipt, reprint, print',
};
