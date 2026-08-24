import type { Messages } from '../../catalogue.js';

/**
 * Users and roles, facilities, the form builder, the audit trail,
 * integrations and the developer platform. Operational.
 *
 * Nothing here is clinical, which is why the whole area is translated rather
 * than deliberately left in English: these are the words an administrator
 * reads while configuring the practice, and getting one of them wrong costs a
 * confused admin rather than a wrong dose.
 *
 * Three shapes recur and are worth naming, because they are the reason some
 * keys look redundant:
 *
 * - `admin.areas.*` names the six areas once. The hub card, the breadcrumb and
 *   the screen's own heading all read the same key, so a screen cannot be
 *   called one thing in the rail and another at the top of itself.
 * - `*.subject` is the noun phrase `AsyncBoundary` drops into its loading and
 *   error copy ("Loading staff accounts"), so it is lower case and reads as a
 *   fragment rather than as a heading.
 * - `*.one` / `*.other` are plural forms selected by the reader's locale
 *   through `pluralKey`, never by `count === 1`. Only the two categories
 *   English and Spanish use are here; a locale with more needs its categories
 *   added to both the helper and every message that uses it.
 *
 * What is deliberately absent: the coded values these screens render from data.
 * A CMS place-of-service label, a capability sentence from the permission
 * matrix, an adapter name, a form field type - those arrive already named and
 * translating them here would put a second, diverging name on a code that
 * already has one.
 */
export const admin: Messages = {
  /* ------------------------------------------ this codebase's own enums */
  /* The audit action, the purpose of use and the staff role are declared in
     `lib/api/admin.ts` and `lib/api/mock/admin.ts`, not by a terminology
     server. The words were being derived by `formatEnumLabel` or written into
     a mock module, and a derived label cannot be translated because there is
     nothing for a translator to open. See `components/admin/labels.ts`. */
  'admin.auditAction.patientRead': 'Patient read',
  'admin.auditAction.patientUpdate': 'Patient update',
  'admin.auditAction.noteSign': 'Note sign',
  'admin.auditAction.orderSign': 'Order sign',
  'admin.auditAction.claimSubmit': 'Claim submit',
  'admin.auditAction.settingUpdate': 'Setting update',
  'admin.auditAction.exportRun': 'Export run',
  'admin.auditAction.loginSuccess': 'Login success',
  'admin.auditAction.loginFailure': 'Login failure',
  'admin.auditAction.breakglassRead': 'Breakglass read',
  'admin.purposeOfUse.treatment': 'Treatment',
  'admin.purposeOfUse.payment': 'Payment',
  'admin.purposeOfUse.operations': 'Operations',
  'admin.purposeOfUse.breakglass': 'Breakglass',
  'admin.purposeOfUse.system': 'System',
  'admin.staffRole.practiceAdmin': 'Practice admin',
  'admin.staffRole.provider': 'Provider',
  'admin.staffRole.medicalAssistant': 'Medical assistant',
  'admin.staffRole.frontDesk': 'Front desk',
  'admin.staffRole.biller': 'Biller',
  'admin.staffRole.readOnly': 'Read only',
  /* ------------------------------------------------------ shared furniture */
  'admin.action.cancel': 'Cancel',
  'admin.action.close': 'Close',

  'admin.confirm.typeToConfirm': 'Type {phrase} to confirm',
  'admin.confirm.frictionHint':
    'This is deliberate friction. Nothing is deleted; the record is kept for the audit trail.',

  /* -------------------------------------------------------------- the hub */
  'admin.hub.description':
    "Users, facilities, forms, the audit trail and the practice's own configuration.",

  /* The six areas. Each label is read by the hub card, the breadcrumb and the
     screen's own heading, so they cannot drift apart. Keywords are the words a
     tired person types instead of the label, and are per-language rather than
     transliterations. */
  'admin.areas.users.label': 'Users and roles',
  'admin.areas.users.description':
    'Staff accounts, the roles they hold, the facilities they work at, and who can do what.',
  'admin.areas.users.keywords': 'staff, accounts, permissions, acl, invite, mfa, deactivate',
  'admin.areas.facilities.label': 'Facilities',
  'admin.areas.facilities.description':
    'Locations with their billing attributes, opening hours and rooms.',
  'admin.areas.facilities.keywords': 'locations, sites, pos code, hours, rooms, npi',
  'admin.areas.forms.label': 'Form builder',
  'admin.areas.forms.description':
    'Build and publish the forms behind intake, encounters, referrals and the portal.',
  'admin.areas.forms.keywords': 'forms, layout, lbf, intake, questionnaire, fields, publish',
  'admin.areas.audit.label': 'Audit trail',
  'admin.areas.audit.description': 'Every access to patient data, append-only and exportable.',
  'admin.areas.audit.keywords': 'audit, access log, phi, breakglass, compliance, export',
  'admin.areas.integrations.label': 'Integrations',
  'admin.areas.integrations.description':
    'The partner seams: prescribing, claims, labs, payments, fax, text and video.',
  'admin.areas.integrations.keywords':
    'adapters, erx, clearinghouse, labs, payments, fax, sms, connections',
  'admin.areas.developer.label': 'Developer platform',
  'admin.areas.developer.description':
    'API keys, SMART on FHIR apps, and webhook subscriptions with their deliveries.',
  'admin.areas.developer.keywords':
    'api, keys, smart, fhir, oauth, webhooks, subscriptions, developer',

  /* ------------------------------------------------- the permission matrix */
  'admin.permissions.caption':
    'Capabilities by role. Each cell is a checkbox naming its capability and role.',
  'admin.permissions.capabilityColumn': 'Capability',
  /* The whole sentence, because a row of nine bare checkboxes is useless read
     aloud. Both values come from the API and stay in their own language. */
  'admin.permissions.cellLabel': '{capability} for {role}',
  'admin.permissions.none': 'This role can do nothing yet. Grant at least one capability.',
  'admin.permissions.can': 'Can {capabilities}.',
  'admin.permissions.cannot': 'Cannot {capabilities}.',

  /* ------------------------------------------------------- users and roles */
  'admin.users.description': 'Who works here, what they can do, and where they can do it.',
  'admin.users.subject': 'staff accounts',
  'admin.users.tableCaption': 'Staff accounts',
  'admin.users.column.name': 'Name',
  'admin.users.column.roles': 'Roles',
  'admin.users.column.facilities': 'Facilities',
  'admin.users.column.mfa': 'Two-factor',
  'admin.users.column.lastActive': 'Last active',
  'admin.users.column.status': 'Status',
  'admin.users.column.actions': 'Actions',
  'admin.users.status.active': 'Active',
  'admin.users.status.invited': 'Invited',
  'admin.users.status.deactivated': 'Deactivated',
  'admin.users.filter.label': 'Filter staff accounts',
  'admin.users.filter.search': 'Search',
  'admin.users.filter.searchPlaceholder': 'Name or email',
  'admin.users.filter.role': 'Role',
  'admin.users.filter.status': 'Status',
  'admin.users.filter.facility': 'Facility',
  'admin.users.filter.allRoles': 'All roles',
  'admin.users.filter.allStatuses': 'All statuses',
  'admin.users.filter.allFacilities': 'All facilities',
  'admin.users.accountCount.one': '{count} account',
  'admin.users.accountCount.other': '{count} accounts',
  'admin.users.empty.title': 'No accounts match these filters',
  'admin.users.empty.message':
    'Every account is filtered out by the current search, role, status or facility. Clear the filters, or invite the colleague you are looking for.',
  'admin.users.provider': 'Provider',
  'admin.users.mfa.enrolled': 'Enrolled',
  'admin.users.mfa.notEnrolled': 'Not enrolled',
  'admin.users.neverActive': 'Never',
  'admin.users.openAccount': 'Open {name}',
  'admin.users.exceptions': 'Exceptions',
  'admin.users.detail.roles': 'Roles',
  'admin.users.detail.facilities': 'Facilities',
  'admin.users.detail.provider': 'Provider',
  'admin.users.detail.npi': 'NPI',
  'admin.users.detail.taxonomy': 'Taxonomy',
  'admin.users.detail.mfa': 'Two-factor',
  'admin.users.detail.lastActive': 'Last active',
  'admin.users.yes': 'Yes',
  'admin.users.no': 'No',
  'admin.users.capabilities.title': 'What this person can do',
  'admin.users.deactivate': 'Deactivate account',
  'admin.users.deactivatedToast':
    '{name} can no longer sign in. The account is kept for the audit trail.',
  'admin.users.confirmDeactivate.title': 'Deactivate {name}',
  'admin.users.confirmDeactivate.consequence':
    'They can no longer sign in. Nothing they wrote is removed, and the account stays resolvable in the audit trail.',
  'admin.users.confirmDeactivate.detail':
    'Open sessions end within a minute. Re-activating later restores the same roles.',
  'admin.users.mfaNotice.title': '{count} active accounts have no second factor.',
  'admin.users.mfaNotice.body':
    'Two-factor authentication is required for anyone who opens a chart. Ask them to enrol from their own account settings.',
  'admin.users.invite.title': 'Invite a colleague',
  'admin.users.invite.description':
    'They set their own password and second factor from the invite link.',
  'admin.users.invite.name': 'Full name',
  'admin.users.invite.email': 'Work email',
  'admin.users.invite.role': 'Role',
  'admin.users.invite.facilities': 'Facilities',
  'admin.users.invite.summaryPending': 'The role summary appears once permissions load.',
  'admin.users.invite.send': 'Send invite',
  'admin.users.invite.sentToast': 'Invite sent to {email}. It expires in 7 days.',
  'admin.users.roles.title': 'Role permissions',
  'admin.users.roles.description':
    'Roles are named bundles. Change one here and it changes for everyone who holds it.',
  'admin.users.roles.edit': 'Edit role permissions',
  'admin.users.roles.save': 'Save role permissions',
  'admin.users.roles.savedToast':
    'Role permissions saved. Everyone holding these roles is affected.',
  'admin.users.roles.subject': 'role permissions',
  'admin.users.roles.empty.title': 'No capabilities are defined',
  'admin.users.roles.empty.message':
    'Roles have nothing to grant until the capability list is loaded. Reload the screen, and report it if the list stays empty.',
  'admin.users.roles.summarise': 'Summarise',
  'admin.users.roles.summariseHint': 'The sentence below describes the role you pick here.',
  'admin.users.roles.summaryLoading': 'Loading the role summary.',
  'admin.users.command.invite.keywords': 'new user, add staff, onboard',
  'admin.users.command.roles.keywords': 'acl, permissions, matrix, what can this role do',
  'admin.users.command.active': 'Show active accounts only',
  'admin.users.command.active.keywords': 'filter, active users',

  /* ------------------------------------------------------------ facilities */
  'admin.facilities.description':
    'Where the practice works: billing attributes, opening hours and rooms.',
  'admin.facilities.subject': 'facilities',
  'admin.facilities.showInactive': 'Show inactive',
  'admin.facilities.add': 'Add a facility',
  'admin.facilities.empty.title': 'No facilities yet',
  'admin.facilities.empty.message':
    'A facility is the physical place a visit happens. Add the practice itself first; rooms and opening hours come with it.',
  'admin.facilities.status.active': 'Active',
  'admin.facilities.status.inactive': 'Inactive',
  'admin.facilities.primary': 'Primary',
  'admin.facilities.pos': 'POS {code}',
  'admin.facilities.roomCount.one': '{count} room',
  'admin.facilities.roomCount.other': '{count} rooms',
  'admin.facilities.hours.closedAllWeek': 'Closed all week',
  'admin.facilities.hours.daysAWeek': '{count} days a week',
  'admin.facilities.edit': 'Edit {name}',
  'admin.facilities.drawer.description':
    'Billing attributes feed claims, hours feed the slot engine, rooms feed the Flow Board.',
  'admin.facilities.save': 'Save facility',
  'admin.facilities.identity.title': 'Identity and billing',
  'admin.facilities.field.name': 'Facility name',
  'admin.facilities.field.phone': 'Phone',
  'admin.facilities.field.placeOfService': 'Place of service',
  'admin.facilities.field.npi': 'Facility NPI',
  'admin.facilities.field.taxId': 'Tax id',
  'admin.facilities.field.street': 'Street',
  'admin.facilities.hours.title': 'Opening hours',
  'admin.facilities.hours.explanation':
    'The slot engine offers appointments inside these hours only. Closed days show no slots at all rather than empty ones.',
  'admin.facilities.hours.caption': 'Opening hours at {name}',
  'admin.facilities.hours.column.day': 'Day',
  'admin.facilities.hours.column.opens': 'Opens',
  'admin.facilities.hours.column.closes': 'Closes',
  'admin.facilities.hours.closed': 'Closed',
  'admin.facilities.rooms.title': 'Rooms',
  'admin.facilities.rooms.empty':
    'No rooms yet. The Flow Board needs at least one room before it can show where a patient is.',
  'admin.facilities.detail.providers': 'Providers working here',
  'admin.facilities.detail.bookableMinutes': 'Bookable minutes a week',
  'admin.facilities.command.open': 'Open the main facility',
  'admin.facilities.command.open.keywords': 'location, site, hours, rooms',
  'admin.facilities.command.inactive': 'Show inactive facilities',
  'admin.facilities.command.inactive.keywords': 'closed, retired location',

  /* ----------------------------------------------------------- audit trail */
  'admin.audit.description': 'Every access to patient data, in the order it happened.',
  'admin.audit.subject': 'audit events',
  'admin.audit.export': 'Export these events',
  'admin.audit.exportCsv': 'Export CSV',
  'admin.audit.exportedToast':
    'Exported {count} events. The export itself is recorded in this trail.',
  'admin.audit.exportUnavailableToast':
    'This browser cannot download files. Copy the filtered table instead.',
  'admin.audit.readOnly.title': 'This record is append-only.',
  'admin.audit.readOnly.body':
    'Nothing on this screen can be edited or deleted, by anyone, including a practice admin. Each event is hashed together with the one before it, so a missing or altered event is detectable.',
  'admin.audit.chip.hashVerified': 'Hash chain verified',
  'admin.audit.chip.readOnly': 'Read only',
  'admin.audit.chip.retention': 'Kept for 6 years',
  'admin.audit.filter.label': 'Filter the audit trail',
  'admin.audit.filter.from': 'From',
  'admin.audit.filter.to': 'To',
  'admin.audit.filter.actor': 'Actor',
  'admin.audit.filter.action': 'Action',
  'admin.audit.filter.purpose': 'Purpose of use',
  'admin.audit.filter.mrn': 'Patient MRN',
  'admin.audit.filter.breakglassOnly': 'Breakglass only',
  'admin.audit.filter.anyone': 'Anyone',
  'admin.audit.filter.anyAction': 'Any action',
  'admin.audit.filter.anyPurpose': 'Any purpose',
  /* Breakglass is only named when there is some, so the ordinary case reads as
     one plain count rather than a count plus a reassuring zero. */
  'admin.audit.summary.one': '{count} event',
  'admin.audit.summary.other': '{count} events',
  'admin.audit.summaryBreakglass.one': '{count} event, {breakglass} breakglass',
  'admin.audit.summaryBreakglass.other': '{count} events, {breakglass} breakglass',
  'admin.audit.column.when': 'When',
  'admin.audit.column.actor': 'Actor',
  'admin.audit.column.action': 'Action',
  'admin.audit.column.target': 'Target',
  'admin.audit.column.patient': 'Patient',
  'admin.audit.column.purpose': 'Purpose of use',
  'admin.audit.column.detail': 'Detail',
  /* The export's header row. Same wording as the on-screen column, because a
     row that reads one way on screen has to read the same way in a
     spreadsheet. */
  'admin.audit.csv.sequence': 'Sequence',
  'admin.audit.csv.when': 'When',
  'admin.audit.csv.actor': 'Actor',
  'admin.audit.csv.role': 'Role',
  'admin.audit.csv.action': 'Action',
  'admin.audit.csv.target': 'Target',
  'admin.audit.csv.patientMrn': 'Patient MRN',
  'admin.audit.csv.purpose': 'Purpose of use',
  'admin.audit.csv.breakglass': 'Breakglass',
  'admin.audit.csv.breakglassReason': 'Breakglass reason',
  'admin.audit.csv.sourceAddress': 'Source address',
  'admin.audit.csv.hash': 'Hash',
  'admin.audit.csv.yes': 'Yes',
  'admin.audit.csv.no': 'No',
  'admin.audit.noChartContext': 'No chart context',
  'admin.audit.breakglass': 'Breakglass',
  'admin.audit.openEvent': 'Open event {sequence}',
  'admin.audit.tableCaption': 'Audit events, newest first',
  'admin.audit.empty.title': 'No events match this query',
  'admin.audit.empty.message':
    'Nothing was recorded for these filters. Widen the date range, or clear the actor and action to see everything in the period.',
  'admin.audit.empty.action': 'Clear the filters',
  'admin.audit.detail.breakglassTitle': 'Emergency access outside the care team.',
  'admin.audit.detail.breakglassReason': 'The reason given was: "{reason}"',
  'admin.audit.detail.actor': 'Actor',
  'admin.audit.detail.role': 'Role',
  'admin.audit.detail.target': 'Target',
  'admin.audit.detail.purpose': 'Purpose of use',
  'admin.audit.detail.patient': 'Patient',
  'admin.audit.detail.mrn': 'MRN',
  'admin.audit.detail.sourceAddress': 'Source address',
  'admin.audit.detail.requestId': 'Request id',
  'admin.audit.hash.title': 'Hash chain',
  'admin.audit.hash.explanation':
    'Each event is hashed together with the hash of the event before it. Changing or removing any event breaks every hash after it, which is what makes this trail tamper-evident rather than merely locked.',
  'admin.audit.hash.position': 'Position',
  'admin.audit.hash.previous': 'Previous hash',
  'admin.audit.hash.current': 'This hash',
  'admin.audit.hash.integrity': 'Integrity',
  'admin.audit.hash.verified': 'Verified against the chain',
  'admin.audit.hash.unverified': 'Not verified. Report this immediately.',
  'admin.audit.command.export': 'Export the filtered audit trail',
  'admin.audit.command.export.keywords': 'csv, download, compliance',
  'admin.audit.command.breakglass': 'Show breakglass access only',
  'admin.audit.command.breakglass.keywords': 'emergency access, override, incident',

  /* ---------------------------------------------------------- form builder */
  'admin.forms.description':
    'Build the forms behind intake, encounters, referrals and the portal. Published versions never change.',
  'admin.forms.subject': 'form definitions',
  'admin.forms.preview': 'Preview',
  'admin.forms.publishVersion': 'Publish version {version}',
  'admin.forms.empty.title': 'No forms yet',
  'admin.forms.empty.message':
    'Forms drive portal intake, encounter documentation and referrals. Build the first one and publish it to the surfaces that need it.',
  'admin.forms.empty.action': 'Build a form',
  'admin.forms.purpose.demographics': 'Demographics',
  'admin.forms.purpose.encounter': 'Encounter',
  'admin.forms.purpose.portalIntake': 'Portal intake',
  'admin.forms.purpose.referral': 'Referral',
  'admin.forms.formSelect': 'Form',
  'admin.forms.formOption': '{name} ({purpose})',
  'admin.forms.versionPublished': 'Version {version}, published',
  'admin.forms.versionDraft': 'Version {version}, draft',
  'admin.forms.responses': '{count} responses',
  'admin.forms.updated': 'Updated {when} by {who}',
  'admin.forms.immutable.title': 'Version {version} is published and cannot change.',
  'admin.forms.immutable.dirty':
    'Your edits are collecting in draft version {version}. Responses already collected stay attached to the version that captured them.',
  'admin.forms.immutable.clean':
    'Editing anything starts draft version {version}. Responses already collected stay attached to the version that captured them.',
  'admin.forms.previewTitle': 'Preview: {name}',
  'admin.forms.renderedAs': 'Rendered as',
  'admin.forms.surface.portal': 'Patient portal',
  'admin.forms.surface.staff': 'Staff, compact',
  'admin.forms.fieldLabelRequired': '{label} (required)',
  'admin.forms.fieldTypes.title': 'Field types',
  'admin.forms.fieldTypes.hint':
    'Adding a field puts it at the end of the first section. Select it on the canvas to move or configure it.',
  'admin.forms.fieldTypes.subject': 'field types',
  'admin.forms.fieldTypes.empty.title': 'No field types available',
  'admin.forms.fieldTypes.empty.message':
    'The form engine reports no field types, so nothing can be added. Reload the screen, and report it if the list stays empty.',
  'admin.forms.addField': 'Add {label}',
  'admin.forms.canvas.title': 'Canvas',
  'admin.forms.chip.required': 'Required',
  'admin.forms.chip.portal': 'Portal',
  'admin.forms.chip.graphable': 'Graphable',
  'admin.forms.chip.askedOnce': 'Asked once',
  'admin.forms.properties.title': 'Field properties',
  'admin.forms.properties.empty':
    'Select a field on the canvas to change its label, whether it is required, and where it appears.',
  'admin.forms.properties.label': 'Label',
  'admin.forms.properties.helpText': 'Help text',
  'admin.forms.properties.helpTextHint':
    "One short sentence, in the patient's register on portal forms.",
  'admin.forms.properties.required': 'Required',
  'admin.forms.properties.portalVisible': 'Visible in the patient portal',
  'admin.forms.properties.graphable': 'Graphable',
  'admin.forms.properties.graphableHint': 'Numeric answers can be plotted on a flowsheet.',
  'admin.forms.properties.askOnce': 'Ask once',
  'admin.forms.properties.askOnceHint':
    'Later visits read the stored answer instead of asking again.',
  'admin.forms.properties.showWhen': 'Show when',
  'admin.forms.properties.showWhenHint':
    'Leave empty to always show. Example: Show when Do you smoke? is Yes',
  'admin.forms.publish.title': 'Publish {name} version {version}',
  'admin.forms.publish.consequence':
    'Version {version} becomes the form every new response uses, and it can never be edited again. Responses already collected stay on the version that captured them.',
  'admin.forms.publish.summary': '{fields} fields, {sections} sections.',
  'admin.forms.publish.added': '{count} added since version {version}.',
  'admin.forms.publish.noneAdded': 'No fields added since the last version.',
  'admin.forms.publishedToast': '{name} version {version} is live on portal intake and encounters.',
  'admin.forms.command.preview': 'Preview this form',
  'admin.forms.command.preview.keywords': 'see it, portal view, staff view',
  'admin.forms.command.publish': 'Publish a new version',
  'admin.forms.command.publish.keywords': 'release, version, go live',

  /* ---------------------------------------------------------- integrations */
  'admin.integrations.description':
    'The partner seams: prescribing, claims, labs, payments, fax, text and video.',
  'admin.integrations.subject': 'integrations',
  'admin.integrations.status.connected': 'Connected',
  'admin.integrations.status.demo': 'Demo mode',
  'admin.integrations.status.error': 'Not working',
  'admin.integrations.status.notConnected': 'Not connected',
  /* What a test connection reports back, per state. Listed per status rather
     than branched, so adding a state forces a sentence to be written for it. */
  'admin.integrations.test.connected':
    'The connection answered in 142 ms and returned the expected response.',
  'admin.integrations.test.demo':
    'The connection answered in 142 ms and returned the expected response.',
  'admin.integrations.test.error':
    'The lab refused the credentials again. Replace the service account, then test once more.',
  'admin.integrations.test.notConnected':
    'There is nothing to test yet. Choose an adapter and save its credentials first.',
  'admin.integrations.sentence.connected': 'Working. Last activity {when}.',
  'admin.integrations.sentence.demo':
    'Working against the built-in demo network. Nothing leaves this practice.',
  'admin.integrations.sentence.error': 'Not working since {when}. Work queues until it is fixed.',
  'admin.integrations.sentence.notConnected':
    'No adapter configured. The features that need this seam are unavailable.',
  'admin.integrations.webhookVerified': 'Webhook verified',
  'admin.integrations.configure': 'Configure {name}',
  'admin.integrations.lastWorking': 'Last working: {when}.',
  'admin.integrations.demoNotice.title': 'Demo mode.',
  'admin.integrations.demoNotice.body':
    'Orders, messages and payments through this seam go to the built-in mock and never reach a real partner. Every screen that transmits through it says so on its own button.',
  'admin.integrations.activity.empty':
    'Nothing has gone through this seam yet. Activity appears here as soon as it does.',
  'admin.integrations.activity.succeeded': 'Succeeded',
  'admin.integrations.activity.failed': 'Failed',
  'admin.integrations.credentials.title': 'Credentials',
  'admin.integrations.credentials.explanation':
    'openrunic stores a reference, not the secret. The value is never displayed, logged or exported, including here.',
  'admin.integrations.credentials.label': 'Secret reference',
  'admin.integrations.credentials.none': 'No credential stored',
  'admin.integrations.testResult.title': 'Test result',
  'admin.integrations.detail.seam': 'Seam',
  'admin.integrations.detail.adapter': 'Adapter',
  'admin.integrations.detail.version': 'Version',
  'admin.integrations.detail.lastActivity': 'Last activity',
  'admin.integrations.detail.lastWorking': 'Last working',
  'admin.integrations.detail.webhook': 'Webhook',
  'admin.integrations.detail.noAdapter': 'None chosen',
  'admin.integrations.detail.notApplicable': 'Not applicable',
  'admin.integrations.detail.verified': 'Verified',
  'admin.integrations.detail.notVerified': 'Not verified',
  'admin.integrations.recentActivity.title': 'Recent activity',
  'admin.integrations.broken.one': '{name} is not working.',
  'admin.integrations.broken.other': '{count} connections are not working.',
  'admin.integrations.broken.body':
    'Work that needs them is queued rather than lost. Open the card to see what the partner said and what to do.',
  'admin.integrations.openFailing': 'Open the failing connection',
  'admin.integrations.command.problem.keywords': 'error, broken adapter, outage',
  'admin.integrations.empty.title': 'No seams configured',
  'admin.integrations.empty.message':
    'Prescribing, claims, labs and payments each run through an adapter. Connect the first one, or keep working in demo mode.',
  'admin.integrations.testConnection': 'Test connection',
  'admin.integrations.saveConnection': 'Save connection',
  'admin.integrations.testToast': '{name}: {result}',

  /* ----------------------------------------------------- developer platform */
  'admin.developer.description':
    'API keys, SMART on FHIR apps, and webhook subscriptions with every delivery.',
  'admin.developer.tabs.label': 'Developer platform sections',
  'admin.developer.tabs.keys': 'API keys',
  'admin.developer.tabs.apps': 'SMART apps',
  'admin.developer.tabs.webhooks': 'Webhooks',
  'admin.developer.keys.column.key': 'Key',
  'admin.developer.keys.column.scopes': 'Scopes',
  'admin.developer.keys.column.created': 'Created',
  'admin.developer.keys.column.lastUsed': 'Last used',
  'admin.developer.keys.column.status': 'Status',
  'admin.developer.keys.column.actions': 'Actions',
  'admin.developer.apps.column.app': 'App',
  'admin.developer.apps.column.launch': 'Launch',
  'admin.developer.apps.column.scopes': 'Scopes',
  'admin.developer.apps.column.lastLaunch': 'Last launch',
  'admin.developer.apps.column.status': 'Status',
  'admin.developer.apps.column.actions': 'Actions',
  'admin.developer.hooks.column.event': 'Event',
  'admin.developer.hooks.column.endpoint': 'Endpoint',
  'admin.developer.hooks.column.health': 'Health',
  'admin.developer.hooks.column.status': 'Status',
  'admin.developer.hooks.column.actions': 'Actions',
  'admin.developer.deliveries.column.when': 'When',
  'admin.developer.deliveries.column.event': 'Event',
  'admin.developer.deliveries.column.response': 'Response',
  'admin.developer.deliveries.column.latency': 'Latency',
  'admin.developer.deliveries.column.attempt': 'Attempt',
  'admin.developer.deliveries.column.outcome': 'Outcome',
  'admin.developer.hookStatus.active': 'Delivering',
  'admin.developer.hookStatus.failing': 'Failing',
  'admin.developer.hookStatus.paused': 'Paused',
  'admin.developer.delivery.delivered': 'Delivered',
  'admin.developer.delivery.failed': 'Failed',
  'admin.developer.delivery.retrying': 'Retrying',
  'admin.developer.launch.ehr': 'From a chart',
  'admin.developer.launch.standalone': 'On its own',
  'admin.developer.keys.neverUsed': 'Never used',
  'admin.developer.keys.active': 'Active',
  'admin.developer.keys.revoked': 'Revoked',
  'admin.developer.keys.revoke': 'Revoke {label}',
  'admin.developer.keys.subject': 'API keys',
  'admin.developer.keys.caption': 'API keys',
  'admin.developer.keys.empty.title': 'No API keys yet',
  'admin.developer.keys.empty.message':
    'A key lets a backend service read this practice through the FHIR API. Create one, choose its scopes, and copy the secret once.',
  'admin.developer.keys.create': 'Create an API key',
  'admin.developer.keys.revokeConsequence':
    'Anything using this key stops working immediately. The key is kept, revoked, so the audit trail still resolves it.',
  'admin.developer.keys.revokeConfirm': 'Revoke key',
  'admin.developer.keys.revokedToast':
    '{label} stops working immediately. The record is kept for the audit trail.',
  'admin.developer.apps.neverLaunched': 'Never',
  'admin.developer.apps.approved': 'Approved',
  'admin.developer.apps.waiting': 'Waiting for approval',
  'admin.developer.apps.open': 'Open {name}',
  'admin.developer.apps.subject': 'registered apps',
  'admin.developer.apps.caption': 'SMART on FHIR apps',
  'admin.developer.apps.empty.title': 'No apps registered',
  'admin.developer.apps.empty.message':
    'A SMART on FHIR app launches from a chart or on its own and reads through scopes you grant. Register the first one to test a launch.',
  'admin.developer.apps.register': 'Register an app',
  'admin.developer.apps.drawerDescription':
    'Launch configuration and every launch this app has attempted.',
  'admin.developer.apps.testLaunch': 'Test launch',
  'admin.developer.apps.testLaunchToast':
    'Test launch of {name} succeeded against the demo tenant with patient OR-100482.',
  'admin.developer.apps.detail.clientId': 'Client id',
  'admin.developer.apps.detail.launch': 'Launch',
  'admin.developer.apps.detail.redirectUris': 'Redirect URIs',
  'admin.developer.apps.detail.scopes': 'Scopes',
  'admin.developer.launchHistory.title': 'Launch history',
  'admin.developer.launchHistory.empty':
    'This app has never launched. Use Test launch to try it against the demo tenant.',
  'admin.developer.launchHistory.patientContext': 'Patient {mrn}.',
  'admin.developer.launchHistory.launched': 'Launched',
  'admin.developer.launchHistory.refused': 'Refused',
  'admin.developer.hooks.health': '{percent}% failed of the last 100',
  'admin.developer.hooks.open': 'Open {event} deliveries',
  'admin.developer.hooks.subject': 'webhook subscriptions',
  'admin.developer.hooks.caption': 'Webhook subscriptions',
  'admin.developer.hooks.empty.title': 'No subscriptions yet',
  'admin.developer.hooks.empty.message':
    'A subscription posts an event to your endpoint as it happens, signed with a shared secret. Create one and fire a test delivery.',
  'admin.developer.hooks.create': 'Create a subscription',
  'admin.developer.hooks.drawerTitle': '{event} deliveries',
  'admin.developer.hooks.retry': 'Retry last delivery',
  'admin.developer.hooks.retryToast':
    'Re-sent the last {event} delivery. Watch the log for the response.',
  'admin.developer.hooks.failingNotice.title': 'This endpoint is failing.',
  'admin.developer.hooks.failingNotice.body':
    'Deliveries retry with backoff for 24 hours, and the subscription pauses itself after 100 consecutive failures so it stops queueing behind a dead endpoint.',
  'admin.developer.hooks.detail.criteria': 'Criteria',
  'admin.developer.hooks.detail.secret': 'Signing secret',
  'admin.developer.hooks.detail.failureRate': 'Failure rate',
  'admin.developer.hooks.detail.failureRateValue': '{percent}% of the last 100',
  'admin.developer.hooks.detail.created': 'Created',
  'admin.developer.hooks.deliveriesCaption': 'Deliveries for {event}',
  'admin.developer.deliveries.noAnswer': 'No answer',
  'admin.developer.deliveries.timedOut': 'Timed out',
  'admin.developer.deliveries.latencyMs': '{ms} ms',
  'admin.developer.scopes.subject': 'scopes',
  'admin.developer.scopes.legend': 'Scopes',
  'admin.developer.scopes.empty.title': 'No scopes available',
  'admin.developer.scopes.empty.message':
    'A key with no scope can read nothing. Reload the screen, and report it if the list stays empty.',
  'admin.developer.newKey.description':
    'Backend services authenticate with this key. It is shown once and cannot be recovered.',
  'admin.developer.newKey.copyTitle': 'Copy this secret now.',
  'admin.developer.newKey.copyBody':
    'openrunic stores a hash of it and cannot show it again. If it is lost, create a new key and revoke this one.',
  'admin.developer.newKey.secret': 'Secret',
  'admin.developer.newKey.purpose': 'What is this key for?',
  'admin.developer.newKey.purposeHint':
    'A person reading the list in a year should know whether they can revoke it.',
  'admin.developer.newKey.type': 'Type',
  'admin.developer.newKey.typeBackend': 'Backend service',
  'admin.developer.newKey.typePortal': 'Portal integration',
  'admin.developer.newKey.copied': 'I have copied the secret',
  'admin.developer.newKey.create': 'Create key',
  'admin.developer.newKey.createdToast':
    '{label} created. Copy the secret now; it is not shown again.',
  'admin.developer.command.key.keywords': 'token, backend service, credential',
  'admin.developer.command.apps': 'Show SMART on FHIR apps',
  'admin.developer.command.apps.keywords': 'smart, launch, oauth, app registration',
  'admin.developer.command.webhooks': 'Show webhook deliveries',
  'admin.developer.command.webhooks.keywords': 'subscriptions, events, retry, delivery log',
};
