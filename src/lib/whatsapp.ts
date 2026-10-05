/**
 * WhatsApp Business notifications (CLAUDE.md §7 WhatsApp): approved message templates sent to
 * buyers, residents and tenants who agreed to them. Isomorphic: shared by the schema, services
 * and the settings page (which shows the template texts to submit to Meta).
 */

/** Language of the templates the organization sends (one approved version per template). */
export const whatsappLanguages = ["fr", "ar"] as const;
export type WhatsappLanguage = (typeof whatsappLanguages)[number];

/** queued → sent → delivered → read, or failed (Meta's statuses, from the webhook). */
export const whatsappStatuses = ["queued", "sent", "delivered", "read", "failed"] as const;
export type WhatsappStatus = (typeof whatsappStatuses)[number];

/** What a message is about; each kind is one template. */
export const whatsappKinds = [
  "payment_received",
  "payment_call",
  "payment_reminder",
  "handover_appointment",
  "charge_call",
  "charge_received",
  "charge_reminder",
  "rent_received",
  "announcement",
  "assembly_convocation",
] as const;
export type WhatsappKind = (typeof whatsappKinds)[number];

export type WhatsappTemplate = {
  /** Default template name in WhatsApp Manager (the organization may use another one). */
  name: string;
  /** Body texts to submit (category « Utility »), placeholders {{1}}… in order. */
  fr: string;
  ar: string;
};

/**
 * The templates, as they must be created and approved in WhatsApp Manager. Bodies never start
 * or end with a placeholder (Meta refuses it); the parameters are sent in order.
 */
export const whatsappTemplates: Record<WhatsappKind, WhatsappTemplate> = {
  payment_received: {
    name: "paiement_recu",
    fr: "Bonjour {{1}}, {{2}} a bien reçu votre paiement de {{3}} pour {{4}}. Reçu n° {{5}}, disponible dans votre espace client.",
    ar: "مرحباً {{1}}، استلمت {{2}} دفعتكم بمبلغ {{3}} عن {{4}}. الوصل رقم {{5}} متاح في فضائكم.",
  },
  payment_call: {
    name: "appel_de_fonds",
    fr: "Bonjour {{1}}, {{2}} vous adresse l'appel de fonds n° {{3}} de {{4}} pour {{5}}, à régler avant le {{6}}. Le document est dans votre espace client.",
    ar: "مرحباً {{1}}، توجّه إليكم {{2}} نداء الأموال رقم {{3}} بمبلغ {{4}} عن {{5}}، يُسدَّد قبل {{6}}. الوثيقة متاحة في فضائكم.",
  },
  payment_reminder: {
    name: "relance_paiement",
    fr: "Bonjour {{1}}, sauf erreur de notre part, {{2}} restent dus à {{3}} pour {{4}}. Merci de régler avant le {{5}}.",
    ar: "مرحباً {{1}}، ما لم يكن هناك خطأ، يبقى مبلغ {{2}} مستحقاً لـ {{3}} عن {{4}}. يرجى التسديد قبل {{5}}.",
  },
  handover_appointment: {
    name: "remise_des_cles",
    fr: "Bonjour {{1}}, {{2}} vous attend pour la remise des clés de {{3}} le {{4}} à {{5}}. Merci de vous munir de votre pièce d'identité.",
    ar: "مرحباً {{1}}، تنتظركم {{2}} لتسليم مفاتيح {{3}} يوم {{4}} على الساعة {{5}}. يرجى إحضار بطاقة التعريف.",
  },
  charge_call: {
    name: "appel_de_charges",
    fr: "Bonjour {{1}}, l'appel de charges n° {{2}} de {{3}} pour {{4}} est émis, à régler avant le {{5}}. Le document est dans votre espace client.",
    ar: "مرحباً {{1}}، صدر نداء الأعباء رقم {{2}} بمبلغ {{3}} عن {{4}}، يُسدَّد قبل {{5}}. الوثيقة متاحة في فضائكم.",
  },
  charge_received: {
    name: "paiement_charges_recu",
    fr: "Bonjour {{1}}, nous avons bien reçu votre paiement de charges de {{2}} pour {{3}}. Reçu n° {{4}}, disponible dans votre espace client.",
    ar: "مرحباً {{1}}، استلمنا دفعتكم للأعباء بمبلغ {{2}} عن {{3}}. الوصل رقم {{4}} متاح في فضائكم.",
  },
  charge_reminder: {
    name: "relance_charges",
    fr: "Bonjour {{1}}, sauf erreur de notre part, {{2}} de charges restent dus pour {{3}}. Merci de régler avant le {{4}}.",
    ar: "مرحباً {{1}}، ما لم يكن هناك خطأ، يبقى مبلغ {{2}} من الأعباء مستحقاً عن {{3}}. يرجى التسديد قبل {{4}}.",
  },
  rent_received: {
    name: "quittance_loyer",
    fr: "Bonjour {{1}}, nous avons bien reçu votre paiement de {{2}} pour {{3}}. Reçu n° {{4}} à votre disposition.",
    ar: "مرحباً {{1}}، استلمنا دفعتكم بمبلغ {{2}} عن {{3}}. الوصل رقم {{4}} تحت تصرفكم.",
  },
  announcement: {
    name: "avis_residents",
    fr: "Nouvel avis aux résidents de {{1}} : {{2}}. À consulter dans votre espace client ou dans le hall de l'immeuble.",
    ar: "إعلان جديد لسكان {{1}}: {{2}}. يمكن الاطلاع عليه في فضائكم أو في مدخل العمارة.",
  },
  assembly_convocation: {
    name: "convocation_assemblee",
    fr: "Bonjour {{1}}, l'assemblée générale de {{2}} se tiendra le {{3}} à {{4}} ({{5}}). La convocation officielle vous est adressée par ailleurs.",
    ar: "مرحباً {{1}}، ستُعقد الجمعية العامة لـ {{2}} يوم {{3}} على الساعة {{4}} ({{5}}). يصلكم الاستدعاء الرسمي بشكل منفصل.",
  },
};

/** Number of parameters a template takes ({{1}}…{{n}}). */
export const templateParamCount = (template: WhatsappTemplate): number =>
  Math.max(0, ...[...template.fr.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));

/**
 * The WhatsApp number (`wa_id`: international, without « + ») of a phone stored in E.164, or
 * null: Algerian landlines (only mobiles 5, 6, 7 have WhatsApp) and malformed numbers.
 */
export function whatsappNumber(phone: string | null | undefined): string | null {
  if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) return null;
  if (phone.startsWith("+213") && !/^\+213[567]\d{8}$/.test(phone)) return null;
  return phone.slice(1);
}

/** Template parameters may not hold line breaks, tabs or long runs of spaces (Meta). */
export function templateParam(value: string, max = 200): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Replies that withdraw the consent (« STOP »). */
const STOP_WORDS = new Set(["stop", "arret", "arrêt", "توقف", "إيقاف", "الغاء", "إلغاء"]);
export const isStopReply = (text: string): boolean =>
  STOP_WORDS.has(
    text
      .trim()
      .toLowerCase()
      .replace(/[.!]+$/, ""),
  );
