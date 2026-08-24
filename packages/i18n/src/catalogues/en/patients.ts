import type { Messages } from '../../catalogue.js';

/**
 * PATIENT SEARCH AND REGISTRATION.
 *
 * The roster, the saved views, the duplicate panel and the registration form:
 * everything a front desk reads while a person is standing in front of them. So
 * the messages say what to do rather than only what is wrong, and none of them
 * carries filler.
 *
 * What is deliberately NOT here: anything the API already names. Sex at birth
 * and record sensitivity arrive as coded values and render through the shared
 * enum formatter, because putting a second, diverging label on a code that
 * already has one is how two screens end up disagreeing about the same record.
 */
export const patients: Messages = {
  /* ----------------------------------------------------------------- roster */
  'patients.roster.title': 'Patients',
  'patients.roster.description':
    'Find a patient, or register a new one without creating a duplicate.',
  'patients.roster.register': 'Register new patient',
  'patients.roster.searchOverline': 'Search',
  'patients.roster.searchTitle': 'Find a patient',
  'patients.roster.searchLabel': 'Name, preferred name or MRN',
  'patients.roster.searchHint': 'Searches as you type. Try a family name or an OR- number.',
  'patients.roster.searchPlaceholder': 'Patientsson, Tess, OR-100482',
  'patients.roster.savedViews': 'Saved views',
  /* The table's caption names the view and the term the rows were narrowed by,
     so a screen reader hears what is below it. One message rather than a
     concatenation: the word order around a quoted term is not the same in every
     language. */
  'patients.roster.captionFiltered': '{view} matching "{term}"',
  'patients.roster.subject': 'the patient list',
  'patients.roster.countOne': '{count} patient in this view',
  'patients.roster.countOther': '{count} patients in this view',
  'patients.roster.emptySearchTitle': 'No patient matches that search',
  'patients.roster.emptySearchMessage':
    'Check the spelling, or search by MRN. If this person is new to the practice, register them.',
  'patients.roster.emptyViewTitle': 'No patients in this view',
  'patients.roster.emptyViewMessage':
    'Nothing matches this saved view yet. Register a patient, or switch to all patients.',

  /* ------------------------------------------------------------ saved views */
  /* A saved view is a named question. Its palette command is written out in
     full rather than assembled from "Show" and a lowercased label, because a
     noun does not lowercase mid-sentence in every language. */
  'patients.view.all.label': 'All patients',
  'patients.view.all.description': 'Everyone in the practice, by family name.',
  'patients.view.all.command': 'Show all patients',
  'patients.view.active.label': 'Active patients',
  'patients.view.active.description': 'Patients the practice still sees.',
  'patients.view.active.command': 'Show active patients',
  'patients.view.inactive.label': 'Inactive records',
  'patients.view.inactive.description': 'Records closed, merged or marked deceased.',
  'patients.view.inactive.command': 'Show inactive records',
  'patients.view.recent.label': 'Recently registered',
  'patients.view.recent.description':
    'Newest records first, for checking a walk-in went in correctly.',
  'patients.view.recent.command': 'Show recently registered',

  /* ------------------------------------------------------------------ table */
  'patients.table.name': 'Patient',
  'patients.table.mrn': 'MRN',
  'patients.table.birthDate': 'Date of birth',
  'patients.table.age': 'Age',
  'patients.table.sex': 'Sex at birth',
  'patients.table.contact': 'Mobile',
  'patients.table.status': 'Record status',
  'patients.table.actions': 'Actions',
  'patients.table.insurance': 'Insurance',
  'patients.table.insuranceFor': 'Insurance and eligibility for {name}',

  /* The record's own state, which the screen decides from `active` and
     `deceasedAt`. The sensitivity badge beside these is NOT here: that one
     renders a coded value the API supplies. */
  'patients.status.active': 'Active',
  'patients.status.inactive': 'Inactive',
  'patients.status.deceased': 'Deceased {date}',

  /* -------------------------------------------------------------- duplicate */
  'patients.duplicate.overline': 'Possible duplicate',
  'patients.duplicate.blockingTitle': 'This patient may already have a record',
  'patients.duplicate.blockingBody':
    'Registering a second record splits the history for this person. Open the existing record, or confirm below that this is a different person.',
  'patients.duplicate.similarTitle': 'Similar records exist in the practice',
  'patients.duplicate.similarBody':
    'These records look close. Check them before registering a new one.',
  'patients.duplicate.open': 'Open this record',
  'patients.duplicate.openFor': 'Open the existing record for {name}',
  'patients.duplicate.overrideLabel': 'This is a different person',
  'patients.duplicate.overrideHint':
    'Recorded with the registration, so the decision is auditable.',
  'patients.duplicate.sameFamilyName': 'Same family name',
  'patients.duplicate.sameGivenName': 'Same given name',
  'patients.duplicate.sameBirthDate': 'Same date of birth',
  'patients.duplicate.samePhone': 'Same mobile number',

  /* ------------------------------------------------------------- validation */
  'patients.validation.given': 'Enter the given name.',
  'patients.validation.family': 'Enter the family name.',
  'patients.validation.mrn': 'Enter the medical record number to file this record under.',
  'patients.validation.birthDateMissing': 'Enter the date of birth as YYYY-MM-DD.',
  'patients.validation.birthDateFormat': 'Use the format YYYY-MM-DD, for example 1987-03-14.',
  'patients.validation.birthDateUnreal': 'That is not a real date. Check the day and month.',
  'patients.validation.birthDateFuture': 'The date of birth is in the future. Check the year.',
  'patients.validation.phoneMissing':
    'Enter a contact number. The practice needs one way to reach the patient.',
  'patients.validation.phoneShape': 'Enter digits only, with an optional country code.',
  'patients.validation.emailShape': 'Check the email address; it is missing an @ or a domain.',
  'patients.validation.emailForPortal':
    'Portal access needs an email address to send the invitation to.',

  /* ----------------------------------------------------------- registration */
  'patients.register.title': 'Register patient',
  'patients.register.description': 'Four fields make a record bookable. Everything else can wait.',
  'patients.register.back': 'Back to patients',
  'patients.register.submit': 'Register patient',
  'patients.register.errorSummaryTitle': 'Fix these before registering',
  'patients.register.blocked':
    'Registration is held until the possible duplicate above is resolved.',
  'patients.register.confirmTitle': 'Register this patient',
  'patients.register.confirmBody':
    'Create a record for {name}, born {birthDate}, under {mrn}. The record becomes bookable immediately.',
  'patients.register.cancel': 'Cancel',
  'patients.register.registering': 'Registering...',
  'patients.register.toastTitle': 'Patient registered',
  'patients.register.toastMessage': '{name} is in the practice under {mrn} and can be booked.',
  'patients.register.openChart': 'Open the chart',

  'patients.section.required': 'Required',
  'patients.section.optional': 'Optional',
  'patients.section.identity': 'Identity',
  'patients.section.contact': 'Contact',
  'patients.section.address': 'Address',
  'patients.section.access': 'Access and privacy',

  'patients.field.mrn': 'Medical record number',
  'patients.field.mrnHint':
    'Proposed by the practice. Overwrite it if this patient already has a number.',
  'patients.field.given': 'Given name',
  'patients.field.family': 'Family name',
  'patients.field.preferred': 'Preferred name',
  'patients.field.preferredHint':
    'What the patient is called. Shown everywhere instead of the given name.',
  'patients.field.birthDate': 'Date of birth',
  /* The shape the field wants, shown in the field. Translatable because the
     order of the parts is a local convention even where the letters are not. */
  'patients.field.birthDatePlaceholder': 'YYYY-MM-DD',
  'patients.field.sexAtBirth': 'Sex at birth',
  'patients.field.sexAtBirthHint':
    'Recorded for clinical decision support. Gender identity is captured on the profile.',
  'patients.field.sexNotRecorded': 'Not recorded',
  'patients.field.pronouns': 'Pronouns',
  'patients.field.pronounsPlaceholder': 'she/her',
  'patients.field.phoneMobile': 'Mobile number',
  'patients.field.phonePlaceholder': '+1 555 0142 118',
  'patients.field.email': 'Email',
  'patients.field.emailHint': 'Needed only for portal access and email reminders.',
  'patients.field.line1': 'Street address',
  'patients.field.city': 'City',
  'patients.field.state': 'State',
  'patients.field.postalCode': 'Postal code',
  'patients.field.language': 'Preferred language',
  'patients.field.sensitivity': 'Record sensitivity',
  'patients.field.sensitivityHint': 'Restricted records are visible only to the care team.',
  'patients.field.portal': 'Invite to the patient portal',
  'patients.field.portalHint': 'Sends an invitation to the email address above.',

  /* The languages a record can carry, each named in the reader's language
     rather than in its own: somebody scanning this list reads one language, not
     four. */
  'patients.language.enUS': 'English (US)',
  'patients.language.esUS': 'Spanish (US)',
  'patients.language.deDE': 'German',
  'patients.language.svSE': 'Swedish',

  /* --------------------------------------------------------------- commands */
  /* Keywords are per-language and not transliterations: somebody searching in
     Spanish does not type "roster". */
  'patients.command.viewKeywords': 'roster, view, filter',
  'patients.command.clearSearch': 'Clear the patient search',
  'patients.command.clearSearch.keywords': 'reset, empty search',
  'patients.command.register': 'Register this patient',
  'patients.command.register.keywords': 'save, create patient, submit registration',
  'patients.command.clearForm': 'Clear the registration form',
  'patients.command.clearForm.keywords': 'reset, start again, empty form',
};
