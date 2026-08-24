import type { Messages } from '../../catalogue.js';

/**
 * The rail rows, the command palette entries, and the search words a tired
 * person types instead of the label. Keywords are per-language and not
 * transliterations: a Spanish speaker looking for the flow board does not type
 * "flow".
 *
 * See `../en/index.ts` for how the areas compose and why they are separate
 * files.
 */
export const nav: Messages = {
  /* The rail, the command palette, and the search words a tired person types
     instead of the label. Keywords are per-language and not transliterations:
     a Spanish speaker looking for the flow board does not type "flow". */
  'nav.schedule': 'Schedule',
  'nav.schedule.keywords': 'calendar, day view, appointments, book, front desk',
  'nav.flowBoard': 'Flow Board',
  'nav.flowBoard.keywords': 'flow, board, waiting, rooms, check in, arrived, wait time',
  'nav.patients': 'Patients',
  'nav.patients.keywords': 'chart, register, search, demographics, mrn',
  'nav.inbox': 'Inbox',
  'nav.inbox.keywords': 'tasks, messages, refills, cosign, worklist',
  'nav.orders': 'Orders',
  'nav.orders.keywords': 'labs, imaging, prescriptions, erx, requisition',
  'nav.billing': 'Billing',
  'nav.billing.keywords': 'fee sheet, charges, claims, era, payments, aging',
  'nav.reports': 'Reports',
  'nav.reports.keywords': 'dashboard, kpi, exports, analytics',
  'nav.admin': 'Admin',
  'nav.admin.keywords': 'users, roles, facilities, form builder, settings, audit',
  'nav.results': 'Results',
  'nav.results.keywords': 'labs, flowsheet, sign off, abnormal, pending review',
  'nav.newPatient': 'New patient',
  'nav.newPatient.keywords': 'register, registration, walk-in, add patient, new record',
  'nav.newOrder': 'New order',
  'nav.newOrder.keywords': 'order labs, order imaging, requisition, composer, procedure',

  /* Billing is one rail row and five workbenches; admin is one and six. Each is
     named so somebody reaches the screen they mean by typing the word they use
     for it, rather than landing on the section and hunting. */
  'nav.feeSheet': 'Fee sheet',
  'nav.feeSheet.keywords': 'charges, charge capture, superbill, cpt, justify, dx link',
  'nav.claimWorkbench': 'Claim workbench',
  'nav.claimWorkbench.keywords': 'claims, scrub, submit, denied, ageing, aging, 837',
  'nav.remittance': 'Remittance',
  'nav.remittance.keywords': 'era, 835, eob, auto-post, posting, exceptions',
  'nav.statements': 'Statements and AR',
  'nav.statements.keywords': 'statements, ar, aging, ageing, dunning, balances, text to pay',
  'nav.payments': 'Payments',
  'nav.payments.keywords': 'payment, copay, collect, receipt, card on file, allocation',
  'nav.usersAndRoles': 'Users and roles',
  'nav.usersAndRoles.keywords': 'staff, accounts, permissions, acl, invite, mfa, deactivate',
  'nav.facilities': 'Facilities',
  'nav.facilities.keywords': 'locations, sites, pos code, hours, rooms, npi',
  'nav.formBuilder': 'Form builder',
  'nav.formBuilder.keywords': 'forms, layout, lbf, intake, questionnaire, fields, publish',
  'nav.auditTrail': 'Audit trail',
  'nav.auditTrail.keywords': 'audit, access log, phi, breakglass, compliance, export',
  'nav.integrations': 'Integrations',
  'nav.integrations.keywords': 'adapters, erx, clearinghouse, labs, payments, fax, connections',
  'nav.developerPlatform': 'Developer platform',
  'nav.developerPlatform.keywords': 'api, keys, smart, fhir, oauth, webhooks, subscriptions',
};
