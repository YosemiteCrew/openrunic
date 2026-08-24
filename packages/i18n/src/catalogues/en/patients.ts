import type { Messages } from '../../catalogue.js';

/**
 * The register, the patient table, and duplicate detection.
 *
 * See `./index.ts` for how the areas compose and why they are separate files.
 *
 * ## What is here and what is deliberately not
 *
 * The words this application chose: headings, buttons, hints, column headers,
 * the validation messages the front desk reads while a patient stands at the
 * counter, and the reasons the duplicate check gives for a candidate. Also the
 * labels for the enums this application defines - sex at birth and record
 * sensitivity - because those are names written here rather than codes arriving
 * from somewhere else.
 *
 * Not here: anything a patient record carries with it. A name, a preferred
 * name, an MRN, a date of birth, a phone number and a language tag are rendered
 * as they arrive. The subscriber relationship on a coverage is a code and lives
 * with the same rule in `insurance.ts`.
 *
 * ## Counts carry both forms
 *
 * A key ending `One` always has a sibling ending `Other`, and the screen picks
 * between them with `plural` from this package rather than with `n === 1`.
 * English needs two forms and is the reason everybody writes the comparison;
 * the language a fork translates into may need four.
 *
 * ## Keywords are words, not transliterations
 *
 * A command's `Keywords` message is the comma-separated set of things a tired
 * person types instead of the label. A translator replaces the whole set rather
 * than a word of it, because somebody searching in Spanish does not type the
 * English synonym.
 */
export const patients: Messages = {
  /* ---------------------------------------------------------- the roster */
  'patients.list.title': 'Patients',
  'patients.list.description':
    'Find a patient, or register a new one without creating a duplicate.',
  'patients.list.registerNew': 'Register new patient',
  'patients.list.searchOverline': 'Search',
  'patients.list.searchTitle': 'Find a patient',
  'patients.list.searchLabel': 'Name, preferred name or MRN',
  'patients.list.searchHint': 'Searches as you type. Try a family name or an OR- number.',
  /* An example of the two things the one field takes, not a value. */
  'patients.list.searchPlaceholder': 'Patientsson, Tess, OR-100482',
  'patients.list.savedViews': 'Saved views',
  /* Noun phrase, lower case: the loading and error copy build a sentence
     around it. */
  'patients.list.subject': 'the patient list',
  /* The table's caption when a search has narrowed it, so a screen reader
     hears what the rows below were narrowed by. The view name is itself a
     translated message, interpolated rather than concatenated. */
  'patients.list.captionSearch': '{view} matching "{term}"',

  'patients.list.empty.title': 'No patients in this view',
  'patients.list.empty.message':
    'Nothing matches this saved view yet. Register a patient, or switch to all patients.',
  'patients.list.empty.searchTitle': 'No patient matches that search',
  'patients.list.empty.searchMessage':
    'Check the spelling, or search by MRN. If this person is new to the practice, register them.',

  'patients.list.countOne': '{count} patient in this view',
  'patients.list.countOther': '{count} patients in this view',

  'patients.list.command.showView': 'Show {view}',
  'patients.list.command.showViewKeywords': 'roster, view, filter',
  'patients.list.command.clearSearch': 'Clear the patient search',
  'patients.list.command.clearSearchKeywords': 'reset, empty search',

  /* ------------------------------------------------------- the saved views */
  /* A saved view is a named question asked of the same table. The name is the
     button, the palette command and the table caption, so it is stated once. */
  'patients.view.all.label': 'All patients',
  'patients.view.all.description': 'Everyone in the practice, by family name.',
  'patients.view.active.label': 'Active patients',
  'patients.view.active.description': 'Patients the practice still sees.',
  'patients.view.inactive.label': 'Inactive records',
  'patients.view.inactive.description': 'Records closed, merged or marked deceased.',
  'patients.view.recent.label': 'Recently registered',
  'patients.view.recent.description':
    'Newest records first, for checking a walk-in went in correctly.',

  /* -------------------------------------------------------- the roster table */
  'patients.table.column.name': 'Patient',
  'patients.table.column.mrn': 'MRN',
  'patients.table.column.birthDate': 'Date of birth',
  'patients.table.column.age': 'Age',
  'patients.table.column.sex': 'Sex at birth',
  'patients.table.column.contact': 'Mobile',
  'patients.table.column.status': 'Record status',
  'patients.table.column.actions': 'Actions',
  'patients.table.deceased': 'Deceased {date}',
  'patients.table.inactive': 'Inactive',
  'patients.table.active': 'Active',
  'patients.table.insurance': 'Insurance',
  'patients.table.insuranceFor': 'Insurance and eligibility for {name}',

  /* ------------------------------------------------------- the record's enums */
  /* Sex at birth and record sensitivity are this application's own vocabulary,
     defined in `lib/api/types.ts`. The label used to be derived from the enum
     member, which is correct in exactly one language and leaves a translator
     nothing to open. */
  'patients.sexAtBirth.notRecorded': 'Not recorded',
  'patients.sexAtBirth.female': 'Female',
  'patients.sexAtBirth.male': 'Male',
  'patients.sexAtBirth.other': 'Other',
  'patients.sexAtBirth.unknown': 'Unknown',
  'patients.sensitivity.normal': 'Normal',
  'patients.sensitivity.restricted': 'Restricted',
  'patients.sensitivity.veryRestricted': 'Very restricted',

  /* ----------------------------------------------------- the duplicate panel */
  'patients.duplicate.overline': 'Possible duplicate',
  'patients.duplicate.blockingTitle': 'This patient may already have a record',
  'patients.duplicate.title': 'Similar records exist in the practice',
  'patients.duplicate.blockingBody':
    'Registering a second record splits the history for this person. Open the existing record, or confirm below that this is a different person.',
  'patients.duplicate.body': 'These records look close. Check them before registering a new one.',
  'patients.duplicate.open': 'Open this record',
  'patients.duplicate.openFor': 'Open the existing record for {name}',
  'patients.duplicate.override': 'This is a different person',
  'patients.duplicate.overrideHint':
    'Recorded with the registration, so the decision is auditable.',
  /* Why a candidate matched, in words the front desk can check against the
     person in front of them. */
  'patients.duplicate.reason.familyName': 'Same family name',
  'patients.duplicate.reason.givenName': 'Same given name',
  'patients.duplicate.reason.birthDate': 'Same date of birth',
  'patients.duplicate.reason.phoneMobile': 'Same mobile number',

  /* --------------------------------------------------------- registration */
  'patients.register.title': 'Register patient',
  'patients.register.description': 'Four fields make a record bookable. Everything else can wait.',
  'patients.register.back': 'Back to patients',
  'patients.register.submit': 'Register patient',
  'patients.register.required': 'Required',
  'patients.register.optional': 'Optional',
  'patients.register.identity': 'Identity',
  'patients.register.contact': 'Contact',
  'patients.register.address': 'Address',
  'patients.register.access': 'Access and privacy',

  'patients.register.field.mrn': 'Medical record number',
  'patients.register.field.mrnHint':
    'Proposed by the practice. Overwrite it if this patient already has a number.',
  'patients.register.field.given': 'Given name',
  'patients.register.field.family': 'Family name',
  'patients.register.field.preferred': 'Preferred name',
  'patients.register.field.preferredHint':
    'What the patient is called. Shown everywhere instead of the given name.',
  'patients.register.field.birthDate': 'Date of birth',
  'patients.register.field.birthDatePlaceholder': 'YYYY-MM-DD',
  'patients.register.field.sexAtBirth': 'Sex at birth',
  'patients.register.field.sexAtBirthHint':
    'Recorded for clinical decision support. Gender identity is captured on the profile.',
  'patients.register.field.pronouns': 'Pronouns',
  'patients.register.field.pronounsPlaceholder': 'she/her',
  'patients.register.field.phoneMobile': 'Mobile number',
  'patients.register.field.phoneMobilePlaceholder': '+1 555 0142 118',
  'patients.register.field.email': 'Email',
  'patients.register.field.emailHint': 'Needed only for portal access and email reminders.',
  'patients.register.field.line1': 'Street address',
  'patients.register.field.city': 'City',
  'patients.register.field.state': 'State',
  'patients.register.field.postalCode': 'Postal code',
  'patients.register.field.languageCode': 'Preferred language',
  'patients.register.field.sensitivityClass': 'Record sensitivity',
  'patients.register.field.sensitivityHint':
    'Restricted records are visible only to the care team.',
  'patients.register.field.portal': 'Invite to the patient portal',
  'patients.register.field.portalHint': 'Sends an invitation to the email address above.',

  /* The language a patient wants to be spoken to in. The tag is the value and
     never moves; only the name a reader sees is here. */
  'patients.register.language.enUS': 'English (US)',
  'patients.register.language.esUS': 'Spanish (US)',
  'patients.register.language.deDE': 'German',
  'patients.register.language.svSE': 'Swedish',

  'patients.register.errors.title': 'Fix these before registering',
  'patients.register.blocked':
    'Registration is held until the possible duplicate above is resolved.',

  'patients.register.confirm.title': 'Register this patient',
  'patients.register.confirm.body':
    'Create a record for {name}, born {birthDate}, under {mrn}. The record becomes bookable immediately.',
  'patients.register.confirm.cancel': 'Cancel',
  'patients.register.confirm.pending': 'Registering...',
  'patients.register.confirm.submit': 'Register patient',

  'patients.register.toast.title': 'Patient registered',
  'patients.register.toast.message': '{name} is in the practice under {mrn} and can be booked.',
  'patients.register.toast.openChart': 'Open the chart',

  'patients.register.command.register': 'Register this patient',
  'patients.register.command.registerKeywords': 'save, create patient, submit registration',
  'patients.register.command.clear': 'Clear the registration form',
  'patients.register.command.clearKeywords': 'reset, start again, empty form',

  /* Validation. Every one says what to do rather than only what is wrong, and
     carries no filler: the person reading has a patient at the desk. */
  'patients.register.error.given': 'Enter the given name.',
  'patients.register.error.family': 'Enter the family name.',
  'patients.register.error.mrn': 'Enter the medical record number to file this record under.',
  'patients.register.error.birthDateRequired': 'Enter the date of birth as YYYY-MM-DD.',
  'patients.register.error.birthDateFormat': 'Use the format YYYY-MM-DD, for example 1987-03-14.',
  'patients.register.error.birthDateUnreal': 'That is not a real date. Check the day and month.',
  'patients.register.error.birthDateFuture': 'The date of birth is in the future. Check the year.',
  'patients.register.error.phoneRequired':
    'Enter a contact number. The practice needs one way to reach the patient.',
  'patients.register.error.phoneFormat': 'Enter digits only, with an optional country code.',
  'patients.register.error.emailFormat': 'Check the email address; it is missing an @ or a domain.',
  'patients.register.error.emailPortal':
    'Portal access needs an email address to send the invitation to.',
};
