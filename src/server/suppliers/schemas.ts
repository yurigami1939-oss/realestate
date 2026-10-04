/** Isomorphic: shared by the supplier forms and their actions. */
import { z } from "zod";

import {
  dateText,
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
