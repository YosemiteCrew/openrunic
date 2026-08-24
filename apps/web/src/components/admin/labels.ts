import type { AuditAction, PurposeOfUse, StaffRole } from '@/lib/api';

/**
 * What this application calls three of its own admin enums, as catalogue keys.
 *
 * All three are declared in `lib/api/admin.ts` and nowhere else: none of them
 * is a Prisma enum, and `StaffRole` and `AuditAction` do not exist outside the
 * web contract at all. That makes them this application's own vocabulary as
 * plainly as anything in this repository is.
 *
 * `PurposeOfUse` needs the distinction drawn precisely, because a code IS
 * involved. `schema.prisma` stores the column as a string and documents it as
 * an "HL7 PurposeOfUse code, e.g. TREAT, HPAYMT, HOPERAT" - and that code is
 * not what these keys name. The union here is the five-way simplification the
 * web contract works in, mapped from the HL7 value by the API layer, and the
 * word for `TREATMENT` is ours in the way "Fee sheet" is. The HL7 code keeps
 * its own name and never reaches a screen.
 *
 * The test that decides membership is not "is it a Prisma enum". It is: does
 * anything outside this codebase supply a display for this value? For all three
 * the answer is no - the API sends the member and nothing else - which is what
 * makes the words ours to write and ours to translate.
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
