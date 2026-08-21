import { describe, expect, it } from 'vitest';

import {
  fromFhirImagingStudy,
  IMAGING_STUDY_DROPPED_FIELDS,
  toFhirImagingStudy,
  type DomainImagingStudy,
} from './imaging-study.js';

function study(overrides: Partial<DomainImagingStudy> = {}): DomainImagingStudy {
  return {
    id: '01890000-0000-7000-8000-000000000001',
    patientId: '01890000-0000-7000-8000-000000000002',
    studyInstanceUid: '1.2.840.113619.2.55.3.604688119.868.1234567890.123',
    modalities: ['CT'],
    status: 'AVAILABLE',
    startedAt: '2026-06-01T10:15:00.000Z',
    numberOfSeries: 4,
    numberOfInstances: 512,
    ...overrides,
  };
}

describe('ImagingStudy round trip', () => {
  it('survives a full study unchanged', () => {
    const full = study({
      encounterId: '01890000-0000-7000-8000-000000000003',
      serviceRequestId: '01890000-0000-7000-8000-000000000004',
      accessionNumber: 'ACC-100482',
      modalities: ['CT', 'SR'],
      description: 'CT chest with contrast',
      retrieveUrl: 'https://pacs.example.invalid/dicomweb/studies/1.2.840',
    });

    expect(fromFhirImagingStudy(toFhirImagingStudy(full))).toStrictEqual(full);
  });

  it('survives a minimal study unchanged', () => {
    // Every optional absent. An absent value must come back absent rather than
    // as an empty string, which is the shape that turns "not recorded" into
    // "recorded as nothing".
    const minimal = study();

    expect(fromFhirImagingStudy(toFhirImagingStudy(minimal))).toStrictEqual(minimal);
  });

  it.each(['REGISTERED', 'AVAILABLE', 'ENTERED_IN_ERROR'] as const)(
    'survives status %s',
    (status) => {
      expect(fromFhirImagingStudy(toFhirImagingStudy(study({ status })))).toMatchObject({ status });
    }
  );
});

describe('what the resource says', () => {
  it('carries the study UID as an identifier, not as the resource id', () => {
    const resource = toFhirImagingStudy(study());

    // The resource id is this system's; the UID is DICOM's. Making them the
    // same string would tie two systems' identifiers together and leave
    // neither able to change.
    expect(resource.id).toBe('01890000-0000-7000-8000-000000000001');
    expect(resource.identifier?.[0]?.value).toBe(
      'urn:oid:1.2.840.113619.2.55.3.604688119.868.1234567890.123'
    );
  });

  it('marks the accession number as an accession number', () => {
    const resource = toFhirImagingStudy(study({ accessionNumber: 'ACC-1' }));
    const accession = resource.identifier?.find((identifier) =>
      identifier.type?.coding?.some((coding) => coding.code === 'ACSN')
    );

    // Typed, because it is the identifier a PACS and a worklist both carry and
    // a consumer has to be able to tell it from the study UID.
    expect(accession?.value).toBe('ACC-1');
  });

  it('codes modalities against the DICOM ontology', () => {
    const resource = toFhirImagingStudy(study({ modalities: ['MR'] }));

    expect(resource.modality?.[0]).toStrictEqual({
      system: 'http://dicom.nema.org/resources/ontology/DCM',
      code: 'MR',
    });
  });

  it('carries the counts a viewer needs to know it has the whole study', () => {
    const resource = toFhirImagingStudy(study());

    expect(resource).toMatchObject({ numberOfSeries: 4, numberOfInstances: 512 });
  });

  it('never invents series it has not seen', () => {
    // openrunic is not a PACS. Describing series and instances it has no record
    // of would be describing images this system has never seen.
    expect(toFhirImagingStudy(study()).series).toBeUndefined();
  });

  it('carries no image data of any kind', () => {
    const serialised = JSON.stringify(
      toFhirImagingStudy(study({ retrieveUrl: 'https://p.invalid/s' }))
    );

    expect(serialised).not.toContain('data:');
    expect(serialised).not.toContain('base64');
  });
});

describe('reading a resource from elsewhere', () => {
  it('accepts a bare UID as well as a urn:oid one', () => {
    const domain = fromFhirImagingStudy({
      resourceType: 'ImagingStudy',
      id: 'x',
      status: 'available',
      subject: { reference: 'Patient/p1' },
      identifier: [{ system: 'urn:dicom:uid', value: '1.2.3' }],
    });

    expect(domain.studyInstanceUid).toBe('1.2.3');
  });

  it('reads an unknown status as available rather than throwing', () => {
    const domain = fromFhirImagingStudy({
      resourceType: 'ImagingStudy',
      status: 'cancelled' as fhir4.ImagingStudy['status'],
      subject: { reference: 'Patient/p1' },
    });

    expect(domain.status).toBe('AVAILABLE');
  });

  it('drops a modality coding with no code rather than carrying an empty one', () => {
    const domain = fromFhirImagingStudy({
      resourceType: 'ImagingStudy',
      status: 'available',
      subject: { reference: 'Patient/p1' },
      modality: [{ system: 'http://dicom.nema.org/resources/ontology/DCM' }, { code: 'CT' }],
    });

    expect(domain.modalities).toStrictEqual(['CT']);
  });

  it('counts nothing as zero, which is what an absent count means', () => {
    const domain = fromFhirImagingStudy({
      resourceType: 'ImagingStudy',
      status: 'available',
      subject: { reference: 'Patient/p1' },
    });

    expect(domain).toMatchObject({ numberOfSeries: 0, numberOfInstances: 0 });
  });
});

describe('the edges of the mapper', () => {
  it('omits the study identifier when there is no UID to carry', () => {
    const resource = toFhirImagingStudy(study({ studyInstanceUid: '' }));

    expect(resource.identifier).toBeUndefined();
  });

  it('omits an empty accession number rather than carrying a blank identifier', () => {
    // A blank identifier is worse than an absent one: it looks like an
    // accession number that happens to be empty.
    const resource = toFhirImagingStudy(study({ accessionNumber: '' }));

    expect(resource.identifier).toHaveLength(1);
  });

  it('omits the endpoint when there is nowhere to send a viewer', () => {
    expect(toFhirImagingStudy(study({ retrieveUrl: '' })).endpoint).toBeUndefined();
  });

  it('omits the start when it is not known', () => {
    expect(toFhirImagingStudy(study({ startedAt: '' })).started).toBeUndefined();
  });
});

describe('a resource that names no patient', () => {
  it('reads an empty subject rather than throwing', () => {
    // A study with no subject should not exist and this is what happens when
    // one arrives. An empty patient id is obviously wrong to whatever reads it
    // next, where a throw would take down the import of a whole batch.
    const domain = fromFhirImagingStudy({
      resourceType: 'ImagingStudy',
      status: 'available',
    } as fhir4.ImagingStudy);

    expect(domain.patientId).toBe('');
  });
});

describe('the dropped fields', () => {
  it('names why the report link does not travel', () => {
    // The link travels the other way: the report carries `imagingStudy`.
    // Duplicating it would give one association two records that can disagree.
    expect(IMAGING_STUDY_DROPPED_FIELDS).toContain('diagnosticReportId');
    expect(IMAGING_STUDY_DROPPED_FIELDS).toContain('tenantId');
  });
});
