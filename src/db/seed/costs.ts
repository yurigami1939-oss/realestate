import { addDays, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import {
  acceptContractSchema,
  createContractorSchema,
  createContractSchema,
  createWorksInvoiceSchema,
  payWorksInvoiceSchema,
  saveBudgetLinesSchema,
} from "@/server/costs/schemas";
import {
  acceptContract,
  createContract,
  createContractor,
  payWorksInvoice,
  recordWorksInvoice,
  saveBudgetLines,
} from "@/server/costs/service";

/**
 * Les Oliviers' costs: its budget, the structural works contract (six progress invoices, the
 * last one to pay), the design office (accepted, its retention still held) and the electrical
 * works just started; paid from the bank account.
 */
export async function seedCosts(owner: TenantCtx, projectIds: Map<string, string>) {
  const projectId = projectIds.get("OLIV");
  if (!projectId) throw new Error("seed: project OLIV missing");
  const today = todayInAlgiers();
  await saveBudgetLines(
    owner,
    saveBudgetLinesSchema.parse({
      projectId,
      lines: [
        { category: "land", label: "Terrain (acte 2022)", amount: "120 000 000" },
        { category: "studies", label: "Études et suivi (BET)", amount: "18 000 000" },
        { category: "works", label: "Gros œuvre", amount: "640 000 000" },
        { category: "works", label: "Corps d'état secondaires", amount: "340 000 000" },
        { category: "networks", label: "VRD et raccordements", amount: "45 000 000" },
        { category: "fees", label: "Notaire, permis, CTC, assurances", amount: "30 000 000" },
        { category: "financial", label: "Intérêts du crédit promoteur", amount: "25 000 000" },
        { category: "marketing", label: "Publicité et bureau de vente", amount: "12 000 000" },
      ],
    }),
  );
  const contractor = async (name: string, activity: string) =>
    (
      await createContractor(
        owner,
        createContractorSchema.parse({ name, activity, nif: "", rib: "" }),
      )
    ).id;
  const contract = async (input: Record<string, string>) =>
    (
      await createContract(
        owner,
        createContractSchema.parse({ projectId, reference: "", notes: "", ...input }),
      )
    ).id;
  const invoice = async (contractId: string, n: number, gross: string, daysAgo: number) =>
    (
      await recordWorksInvoice(
        owner,
        createWorksInvoiceSchema.parse({
          contractId,
          number: `${n}/2026`,
          invoicedOn: addDays(today, -daysAgo),
          dueOn: addDays(today, -daysAgo + 30),
          label: `Situation n° ${n}`,
          gross,
        }),
      )
    ).id;
  const pay = (invoiceId: string, daysAgo: number) =>
    payWorksInvoice(
      owner,
      payWorksInvoiceSchema.parse({
        invoiceId,
        paidOn: addDays(today, -daysAgo),
        method: "bank_transfer",
        reference: `VIR-${daysAgo}`,
      }),
    );

  const structure = await contract({
    supplierId: await contractor("ETB Bensaïd & Fils", "Gros œuvre"),
    category: "works",
    reference: "M-OLIV-01/2024",
    title: "Gros œuvre Blocs A et B",
    amount: "640 000 000",
    retention: "5",
    signedOn: "2024-06-15",
    plannedEndOn: addDays(today, 150),
  });
  const situations = [48_000_000, 52_000_000, 61_000_000, 58_000_000, 64_000_000, 55_000_000];
  for (const [index, gross] of situations.entries()) {
    const daysAgo = 330 - index * 60;
    const id = await invoice(structure, index + 1, String(gross), daysAgo);
    if (index < situations.length - 1) await pay(id, daysAgo - 20);
  }

  const studies = await contract({
    supplierId: await contractor("BET Atlas Ingénierie", "Bureau d'études et suivi"),
    category: "studies",
    reference: "C-OLIV-BET",
    title: "Études et suivi des travaux",
    amount: "18 000 000",
    retention: "5",
    signedOn: "2024-02-01",
    plannedEndOn: addDays(today, -30),
  });
  for (const [index, gross] of [6_000_000, 6_000_000, 6_000_000].entries()) {
    const daysAgo = 400 - index * 150;
    await pay(await invoice(studies, index + 1, String(gross), daysAgo), daysAgo - 15);
  }
  await acceptContract(
    owner,
    acceptContractSchema.parse({
      contractId: studies,
      stage: "provisional",
      acceptedOn: addDays(today, -20),
      notes: "Dossier des ouvrages exécutés remis.",
    }),
  );

  const electrical = await contract({
    supplierId: await contractor("Électro-Bâtiment SARL", "Électricité et courants faibles"),
    category: "works",
    reference: "M-OLIV-07/2025",
    title: "Électricité Blocs A et B",
    amount: "95 000 000",
    retention: "5",
    signedOn: addDays(today, -60),
    plannedEndOn: addDays(today, 240),
  });
  await invoice(electrical, 1, "9 500 000", 10);
}
