/** Isomorphic: shared by the buyer forms and actions. Inputs are form strings. */
import { z } from "zod";

import { buyerDocumentKinds, civilities, documentStatuses, maritalStatuses } from "@/lib/sales";
import {
  optionalDateText,
  optionalEmailText,
  optionalEnum,
  optionalNinText,
  optionalPhoneText,
  optionalText,
  phoneText,
  requiredText,
} from "@/lib/zod";

const optionalId = () =>
  z
    .union([z.uuid(), z.literal("")])
    .optional()
    .transform((v) => (v ? v : null));

export const buyerFields = z.object({
  civility: optionalEnum(civilities),
  lastName: requiredText(80),
  firstName: requiredText(80),
  lastNameAr: optionalText(80),
  firstNameAr: optionalText(80),
  birthDate: optionalDateText(),
  birthPlace: optionalText(80),
  fatherFirstName: optionalText(80),
  motherFullName: optionalText(120),
  nin: optionalNinText(),
  idCardNumber: optionalText(30),
  idCardIssuedOn: optionalDateText(),
  idCardIssuedBy: optionalText(80),
  phone: phoneText(),
  phone2: optionalPhoneText(),
  email: optionalEmailText(),
  address: optionalText(300),
  commune: optionalText(80),
  wilaya: optionalText(80),
  profession: optionalText(120),
  employer: optionalText(120),
  maritalStatus: optionalEnum(maritalStatuses),
  notes: optionalText(2000),
});

export const createBuyerSchema = buyerFields.extend({ leadId: optionalId() });
export const updateBuyerSchema = buyerFields.extend({ buyerId: z.uuid() });
export const buyerIdSchema = z.object({ buyerId: z.uuid() });

export const setBuyerDocumentSchema = z.object({
  buyerId: z.uuid(),
  kind: z.enum(buyerDocumentKinds),
  status: z.enum(documentStatuses),
  note: optionalText(300),
});

export const buyerListParams = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});
export type BuyerListParams = z.output<typeof buyerListParams>;

export const BUYERS_PAGE_SIZE = 25;
