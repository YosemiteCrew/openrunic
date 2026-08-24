import type { AuditAction, PurposeOfUse, StaffRole } from '@/lib/api';

/**
 * What this application calls three of its own admin enums, as catalogue keys.
 *
 * All three are declared in `lib/api/admin.ts` and mirror enums in
 * `@openrunic/database`. None comes from a terminology server, so the words are
 * this codebase's to write and its to translate.
 *
 * They were reaching a screen two different ways, and both produced English no
 * translator could open. The audit action and the purpose of use went through
 * `formatEnumLabel`, which turns `PATIENT_READ` into "Patient read" and is
 * correct in exactly one language. The staff role went through
 * `STAFF_ROLE_LABELS`, a `Record<StaffRole, string>` of English words living in
 * `lib/api/mock/admin.ts` - a mock module the real screen imports from, which
 * is the more surprising of the two because it looks like data arriving from
 * somewhere.
 *
 * Carried as `labelKey` data for the two reasons `components/orders/labels.ts`
 * gives: the reader's language is not known at module scope, and
 * `catalogue-drift.test.ts` reads `somethingKey:` out of the source, so a key
 * defined nowhere fails the build instead of rendering as itself in an audit
 * row.
 */

export const AUDIT_ACTION_LABELS: Record<AuditAction, { labelKey: string }> = {
  PATIENT_READ: { labelKey: 'admin.auditAction.patientRead' },
  PATIENT_UPDATE: { labelKey: 'admin.auditAction.patientUpdate' },
  NOTE_SIGN: { labelKey: 'admin.auditAction.noteSign' },
  ORDER_SIGN: { labelKey: 'admin.auditAction.orderSign' },
  CLAIM_SUBMIT: { labelKey: 'admin.auditAction.claimSubmit' },
  SETTING_UPDATE: { labelKey: 'admin.auditAction.settingUpdate' },
  EXPORT_RUN: { labelKey: 'admin.auditAction.exportRun' },
  LOGIN_SUCCESS: { labelKey: 'admin.auditAction.loginSuccess' },
  LOGIN_FAILURE: { labelKey: 'admin.auditAction.loginFailure' },
  BREAKGLASS_READ: { labelKey: 'admin.auditAction.breakglassRead' },
};

export const PURPOSE_OF_USE_LABELS: Record<PurposeOfUse, { labelKey: string }> = {
  TREATMENT: { labelKey: 'admin.purposeOfUse.treatment' },
  PAYMENT: { labelKey: 'admin.purposeOfUse.payment' },
  OPERATIONS: { labelKey: 'admin.purposeOfUse.operations' },
  BREAKGLASS: { labelKey: 'admin.purposeOfUse.breakglass' },
  SYSTEM: { labelKey: 'admin.purposeOfUse.system' },
};

export const STAFF_ROLE_KEYS: Record<StaffRole, { labelKey: string }> = {
  PRACTICE_ADMIN: { labelKey: 'admin.staffRole.practiceAdmin' },
  PROVIDER: { labelKey: 'admin.staffRole.provider' },
  MEDICAL_ASSISTANT: { labelKey: 'admin.staffRole.medicalAssistant' },
  FRONT_DESK: { labelKey: 'admin.staffRole.frontDesk' },
  BILLER: { labelKey: 'admin.staffRole.biller' },
  READ_ONLY: { labelKey: 'admin.staffRole.readOnly' },
};
