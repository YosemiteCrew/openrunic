import {
  addressElement,
  personName,
  readAddress,
  readTelecom,
  telecom,
  templateId,
  writeTime,
} from './datatypes.js';
import type { Author, CcdDocument, DocumentPatient, Organisation } from './domain.js';
import { CCD_DOCUMENT_CODE, CDA_TYPE_ID, CODE_SYSTEMS, DOCUMENT_TEMPLATES } from './oids.js';
import { fromHl7 } from './time.js';
import { attr, childNamed, childrenNamed, element, path, textOf } from './xml/tree.js';
import type { XmlElement } from './xml/tree.js';

/**
 * THE HEADER: who this is about, who wrote it, and who is answerable for it.
 *
 * Ordering in this file is not stylistic. CDA release 2 has a fixed element
 * order in `ClinicalDocument`, and a document whose `code` comes before its `id`
 * fails schema validation at the receiving end - which is reported to the person
 * on the other side as "your document is invalid" with no more detail than that.
 * The order written here is the schema's.
 *
 * `custodian` is the element people leave out and the one that matters legally:
 * it names the organisation answerable for maintaining the record. A document
 * with no custodian is a document nobody will accept, because there is nobody to
 * ask about it.
 */

const NAMESPACE = 'urn:hl7-org:v3';

export function headerElements(document: CcdDocument): XmlElement[] {
  return [
    element('realmCode', { code: 'US' }),
    element('typeId', { root: CDA_TYPE_ID.root, extension: CDA_TYPE_ID.extension }),
    templateId(DOCUMENT_TEMPLATES.US_REALM_HEADER),
    templateId(DOCUMENT_TEMPLATES.CCD),
    element('id', { root: document.id }),
    element('code', {
      code: CCD_DOCUMENT_CODE.code,
      codeSystem: CODE_SYSTEMS.LOINC.oid,
      codeSystemName: CODE_SYSTEMS.LOINC.name,
      displayName: CCD_DOCUMENT_CODE.display,
    }),
    element('title', {}, [document.title]),
    element('effectiveTime', { value: writeTime(document.effectiveAt) }),
    // `N` - normal. Every clinical document carries a confidentiality code, and
    // there is no honest default other than this one: claiming `R` (restricted)
    // on a document that is not restricted teaches a receiving system to ignore
    // the field.
    element('confidentialityCode', {
      code: 'N',
      codeSystem: CODE_SYSTEMS.CONFIDENTIALITY.oid,
    }),
    element('languageCode', { code: document.patient.languageCode ?? 'en-US' }),
    recordTarget(document.patient),
    authorElement(document.author, document.effectiveAt),
    custodian(document.custodian),
    ...(document.coveringPeriod === undefined ? [] : [documentationOf(document.coveringPeriod)]),
  ];
}

/** The root element, with the namespaces every CDA carries. */
export function clinicalDocument(children: readonly XmlElement[]): XmlElement {
  return element(
    'ClinicalDocument',
    {
      xmlns: NAMESPACE,
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    },
    children
  );
}

function recordTarget(patient: DocumentPatient): XmlElement {
  const role: XmlElement[] = [
    // The practice's own identifier for the person, and the medical record
    // number beside it. Two ids rather than one: the UUID is what makes a
    // reconciliation deterministic, and the MRN is what a human at the other end
    // will actually search for.
    element('id', { root: patient.id }),
    element('id', { root: '2.16.840.1.113883.4.1', extension: patient.mrn }),
  ];

  const address = addressElement(patient.address);
  if (address !== undefined) role.push(address);
  role.push(...telecom(patient.phone, patient.email));

  role.push(
    element('patient', {}, [
      personName(patient.givenName, patient.familyName),
      genderElement(patient.gender),
      element('birthTime', { value: writeTime(patient.birthDate) }),
      ...(patient.languageCode === undefined
        ? []
        : [
            element('languageCommunication', {}, [
              element('languageCode', { code: patient.languageCode }),
            ]),
          ]),
    ])
  );

  return element('recordTarget', {}, [element('patientRole', {}, role)]);
}

/**
 * HL7 AdministrativeGender is a three-value vocabulary - `M`, `F`, `UN` - not the
 * four FHIR words, and the gap between them is the interesting part.
 *
 * `other` and `unknown` are different statements: one is an answer the practice
 * recorded, the other is the absence of one. Writing both as `UN` loses that,
 * and it loses it in the direction that matters - a receiving system reads a
 * recorded answer as a gap in the record and may go asking for it again.
 *
 * So `other` takes `UN`, which is what that code means, and `unknown` takes
 * `nullFlavor="UNK"`, which is how CDA says nothing was recorded. Both are the
 * specification's own machinery rather than a convention invented here.
 */
function genderElement(gender: DocumentPatient['gender']): XmlElement {
  if (gender === 'unknown') {
    return element('administrativeGenderCode', { nullFlavor: 'UNK' });
  }
  return element('administrativeGenderCode', {
    code: genderCode(gender),
    codeSystem: CODE_SYSTEMS.ADMIN_GENDER.oid,
    displayName: gender,
  });
}

/** `UN` is undifferentiated: a recorded answer that is neither male nor female. */
function genderCode(gender: DocumentPatient['gender']): string {
  if (gender === 'male') return 'M';
  if (gender === 'female') return 'F';
  return 'UN';
}

function readGender(node: XmlElement | undefined): DocumentPatient['gender'] {
  const code = attr(node, 'code');
  if (code === 'M') return 'male';
  if (code === 'F') return 'female';
  // `UN` is a recorded answer; an absent code, whatever its nullFlavor, is not.
  return code === 'UN' ? 'other' : 'unknown';
}

function authorElement(author: Author, at: string): XmlElement {
  const assigned: XmlElement[] = [element('id', { root: author.id })];
  if (author.npi !== undefined && author.npi !== '') {
    assigned.push(element('id', { root: '2.16.840.1.113883.4.6', extension: author.npi }));
  }
  assigned.push(element('assignedPerson', {}, [personName(author.givenName, author.familyName)]));

  return element('author', {}, [
    element('time', { value: writeTime(at) }),
    element('assignedAuthor', {}, assigned),
  ]);
}

function custodian(organisation: Organisation): XmlElement {
  const custodianOrganisation: XmlElement[] = [
    element('id', { root: organisation.id }),
    element('name', {}, [organisation.name]),
  ];
  custodianOrganisation.push(...telecom(organisation.phone, undefined));
  const address = addressElement(organisation.address);
  if (address !== undefined) custodianOrganisation.push(address);

  return element('custodian', {}, [
    element('assignedCustodian', {}, [
      element('representedCustodianOrganization', {}, custodianOrganisation),
    ]),
  ]);
}

function documentationOf(period: { readonly start: string; readonly end?: string }): XmlElement {
  return element('documentationOf', {}, [
    element('serviceEvent', { classCode: 'PCPR' }, [
      element('effectiveTime', {}, [
        element('low', { value: writeTime(period.start) }),
        period.end === undefined
          ? element('high', { nullFlavor: 'UNK' })
          : element('high', { value: writeTime(period.end) }),
      ]),
    ]),
  ]);
}

/** Everything the header carries, read back off a parsed document. */
export function readHeader(root: XmlElement): {
  id: string;
  title: string;
  effectiveAt: string;
  patient: DocumentPatient;
  author: Author;
  custodian: Organisation;
  coveringPeriod?: { start: string; end?: string };
} {
  const patientRole = path(root, 'recordTarget', 'patientRole');
  const patient = childNamed(patientRole, 'patient');
  const ids = childrenNamed(patientRole, 'id');
  const telecoms = childrenNamed(patientRole, 'telecom');
  const name = childNamed(patient, 'name');

  const assignedAuthor = path(root, 'author', 'assignedAuthor');
  const authorIds = childrenNamed(assignedAuthor, 'id');
  const authorName = path(assignedAuthor, 'assignedPerson', 'name');

  const organisation = path(
    root,
    'custodian',
    'assignedCustodian',
    'representedCustodianOrganization'
  );
  const birth = fromHl7(attr(childNamed(patient, 'birthTime'), 'value'));
  const language = attr(path(patient, 'languageCommunication', 'languageCode'), 'code');
  const address = readAddress(childNamed(patientRole, 'addr'));
  const phone = readTelecom(telecoms, 'tel');
  const email = readTelecom(telecoms, 'mailto');
  const npi = authorIds.find((node) => attr(node, 'extension') !== undefined);
  const period = readPeriod(root);
  const organisationPhone = readTelecom(childrenNamed(organisation, 'telecom'), 'tel');
  const organisationAddress = readAddress(childNamed(organisation, 'addr'));

  return {
    id: attr(childNamed(root, 'id'), 'root') ?? '',
    title: textOf(childNamed(root, 'title')),
    effectiveAt: fromHl7(attr(childNamed(root, 'effectiveTime'), 'value')) ?? '',
    patient: {
      id: attr(ids[0], 'root') ?? '',
      mrn: attr(ids[1], 'extension') ?? '',
      givenName: textOf(childNamed(name, 'given')),
      familyName: textOf(childNamed(name, 'family')),
      birthDate: (birth ?? '').slice(0, 10),
      gender: readGender(childNamed(patient, 'administrativeGenderCode')),
      ...(language === undefined ? {} : { languageCode: language }),
      ...(address === undefined ? {} : { address }),
      ...(phone === undefined ? {} : { phone }),
      ...(email === undefined ? {} : { email }),
    },
    author: {
      id: attr(authorIds[0], 'root') ?? '',
      givenName: textOf(childNamed(authorName, 'given')),
      familyName: textOf(childNamed(authorName, 'family')),
      ...(npi === undefined ? {} : { npi: attr(npi, 'extension') ?? '' }),
    },
    custodian: {
      id: attr(childNamed(organisation, 'id'), 'root') ?? '',
      name: textOf(childNamed(organisation, 'name')),
      ...(organisationPhone === undefined ? {} : { phone: organisationPhone }),
      ...(organisationAddress === undefined ? {} : { address: organisationAddress }),
    },
    ...(period === undefined ? {} : { coveringPeriod: period }),
  };
}

function readPeriod(root: XmlElement): { start: string; end?: string } | undefined {
  const time = path(root, 'documentationOf', 'serviceEvent', 'effectiveTime');
  const start = fromHl7(attr(childNamed(time, 'low'), 'value'));
  if (start === undefined) return undefined;
  const end = fromHl7(attr(childNamed(time, 'high'), 'value'));
  return end === undefined ? { start } : { start, end };
}
