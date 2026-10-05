import type { PaymentMethod } from "@/lib/sales";

/** How each payment method is printed on receipts and quittances (French, Arabic). */
export const paymentMethodLabels: Record<PaymentMethod, { fr: string; ar: string }> = {
  cash: { fr: "Espèces", ar: "نقداً" },
  cheque: { fr: "Chèque", ar: "صك" },
  bank_transfer: { fr: "Virement bancaire", ar: "تحويل بنكي" },
  ccp: { fr: "Versement CCP", ar: "دفع عبر الحساب البريدي الجاري" },
  bank_loan: { fr: "Déblocage de crédit bancaire", ar: "صرف قرض بنكي" },
  card: {
    fr: "Paiement en ligne par carte CIB / Edahabia",
    ar: "دفع إلكتروني ببطاقة CIB / الذهبية",
  },
};
