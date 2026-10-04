/** Isomorphic: shared by the supplier forms and their actions. */
import { z } from "zod";

import { chargePaymentMethods } from "@/lib/residences";
import {
  dateText,
  moneyText,
  optionalDateText,
  optionalEmailText,
  optionalMoneyText,
  optionalPhoneText,
  optionalText,
  requiredText,
} from "@/lib/zod";

const supplierFields = {
  name: requiredText(120),
  activity: optionalText(120),
  phone: optionalPhoneText(),
  email: optionalEmailText(),
  address: optionalText(300),
  nif: optionalText(30),
  rcNumber: optionalText(30),
  rib: optionalText(40),
  notes: optionalText(1000),
};

export const createSupplierSchema = z.object(supplierFields);
export const updateSupplierSchema = z.object({ supplierId: z.uuid(), ...supplierFields });
export const supplierIdSchema = z.object({ supplierId: z.uuid() });

/** "" → null for optional ids coming from selects. */
const optionalId = () => z.union([z.uuid(), z.literal("")]).transform((v) => (v === "" ? null : v));

const contractFields = {
  /** Charge category its invoices are booked to by default. */
  categoryId: optionalId(),
  label: requiredText(160),
  startOn: dateText(),
  endOn: optionalDateText(),
  annualAmount: optionalMoneyText(),
  notes: optionalText(1000),
};

const contractPeriod = (v: { startOn: string; endOn: string | null }) =>
  v.endOn === null || v.endOn >= v.startOn;

export const createContractSchema = z
  .object({ supplierId: z.uuid(), residenceId: z.uuid(), ...contractFields })
  .refine(contractPeriod, { path: ["endOn"], message: "suppliers.errors.endBeforeStart" });
export const updateContractSchema = z
  .object({ contractId: z.uuid(), ...contractFields })
  .refine(contractPeriod, { path: ["endOn"], message: "suppliers.errors.endBeforeStart" });
export const contractIdSchema = z.object({ contractId: z.uuid() });

const invoiceFields = {
  /** Charge category it is booked to (budget vs actual); none when paid from the reserve fund. */
  categoryId: optionalId(),
  contractId: optionalId(),
  /** The supplier's invoice number. */
  number: requiredText(40),
  invoiceOn: dateText(),
  dueOn: optionalDateText(),
  label: requiredText(200),
  amount: moneyText().refine((v) => v > 0n, "validation.amount"),
  /** Works paid from the reserve fund instead of the year's budget. */
  fromReserve: z.boolean(),
  notes: optionalText(1000),
};

type InvoiceRules = {
  fromReserve: boolean;
  categoryId: string | null;
  invoiceOn: string;
  dueOn: string | null;
};
function invoiceRules(v: InvoiceRules, ctx: z.RefinementCtx) {
  if (!v.fromReserve && v.categoryId === null) {
    ctx.addIssue({
      code: "custom",
      path: ["categoryId"],
      message: "suppliers.errors.categoryRequired",
    });
  }
  if (v.dueOn !== null && v.dueOn < v.invoiceOn) {
    ctx.addIssue({ code: "custom", path: ["dueOn"], message: "suppliers.errors.dueBeforeInvoice" });
  }
}

export const createInvoiceSchema = z
  .object({ supplierId: z.uuid(), residenceId: z.uuid(), ...invoiceFields })
  .superRefine(invoiceRules);
export const updateInvoiceSchema = z
  .object({ invoiceId: z.uuid(), ...invoiceFields })
  .superRefine(invoiceRules);
export const invoiceIdSchema = z.object({ invoiceId: z.uuid() });

/** Payment of a supplier invoice by the residence. */
export const payInvoiceSchema = z.object({
  invoiceId: z.uuid(),
  paidOn: dateText(),
  method: z.enum(chargePaymentMethods),
  reference: optionalText(60),
});
