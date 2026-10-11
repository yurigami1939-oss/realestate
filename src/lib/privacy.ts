/**
 * Loi 18-07 (CLAUDE.md §7 Personal data): how long the organization keeps what is not needed
 * for a contract — set by the gérant, never hard-coded — and the register of the processing
 * the app performs for it. Isomorphic.
 */
import { addMonths, type CalendarDate } from "./dates";

/** The name an anonymized prospect keeps (right to erasure). */
export const ANONYMIZED_NAME = "Prospect anonymisé";

/**
 * Retention periods in months (0 = not applied automatically): prospects who never bought,
 * anonymized that long after their last activity; the phone numbers and texts of the WhatsApp
 * and SMS logs, erased that long after sending.
 */
export type PrivacySettings = { leadRetentionMonths: number; messageRetentionMonths: number };

export const defaultPrivacySettings: PrivacySettings = {
  leadRetentionMonths: 0,
  messageRetentionMonths: 0,
};

/** The saved settings over the defaults. */
export function privacySettings(saved: Partial<PrivacySettings> | null): PrivacySettings {
  return { ...defaultPrivacySettings, ...saved };
}

/** At most 10 years. */
export const MAX_RETENTION_MONTHS = 120;

/** The day before which records are past a retention period, or null when it is off. */
export function retentionCutoff(today: CalendarDate, months: number): CalendarDate | null {
  return months > 0 ? addMonths(today, -months) : null;
}

/**
 * The processing activities of the register (registre des traitements), each described in the
 * catalogs (`privacy.register.<key>`: purpose, data, legal basis, recipients, retention); the
 * ones whose retention the app applies name the setting.
 */
export const processingActivities = [
  { key: "prospects", retention: "leadRetentionMonths" },
  { key: "sales", retention: null },
  { key: "residents", retention: null },
  { key: "rentals", retention: null },
  { key: "owners", retention: null },
  { key: "payments", retention: null },
  { key: "notifications", retention: "messageRetentionMonths" },
  { key: "push", retention: null },
  { key: "staff", retention: null },
  { key: "accounts", retention: null },
] as const satisfies readonly { key: string; retention: keyof PrivacySettings | null }[];

export type ProcessingActivity = (typeof processingActivities)[number]["key"];

/** What erased message logs keep in place of the recipient. */
export const ERASED_RECIPIENT = "—";

/** What a person may agree to: WhatsApp notifications, commercial offers (other projects…). */
export const consentPurposes = ["whatsapp", "marketing"] as const;
export type ConsentPurpose = (typeof consentPurposes)[number];

/** How a consent was given or withdrawn: by staff (form, import), a website, a « STOP » reply. */
export const consentSources = ["staff", "capture", "stop_reply"] as const;
export type ConsentSource = (typeof consentSources)[number];

/** The records a consent belongs to. */
export const consentSubjects = ["lead", "buyer", "resident", "lease"] as const;
export type ConsentSubject = (typeof consentSubjects)[number];

/** The files whose opening is logged (who read a person's data, and when). */
export const accessSubjects = ["lead", "buyer", "lease", "owner"] as const;
export type AccessSubject = (typeof accessSubjects)[number];
