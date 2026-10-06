/**
 * Demo CRM (module 2): ~30 leads across sources and pipeline stages, visits, follow-ups
 * (overdue, today, upcoming), notes, lost reasons and two duplicate pairs.
 * Written through the services, relative to the seeding time so the agenda is always current.
 */
import type { LeadSource, LeadStage, LostReason } from "@/lib/crm";
import { addMonths, toCalendarDate, todayInAlgiers } from "@/lib/dates";
import type { Typology } from "@/lib/inventory";
import type { TenantCtx } from "@/server/auth/session";
import { completeFollowUp, createFollowUp } from "@/server/crm/follow-ups";
import { addLeadNote, changeLeadStage, createLead } from "@/server/crm/leads";
import {
  changeLeadStageSchema,
  createFollowUpSchema,
  createLeadSchema,
  saveTargetsSchema,
  scheduleVisitSchema,
  updateVisitSchema,
} from "@/server/crm/schemas";
import { saveTargets } from "@/server/crm/targets";
import { scheduleVisit, updateVisit } from "@/server/crm/visits";
import { saveMarketingSpend } from "@/server/reports/marketing";
import { saveMarketingSpendSchema } from "@/server/reports/schemas";

type Owner = "agentA" | "agentB" | "manager" | "none";

type DemoLead = {
  name: string;
  phone: string;
  city: string;
  source: LeadSource;
  project: "OLIV" | "CORN" | null;
  typologies: Typology[];
  budget: string | null;
  owner: Owner;
  stage: LeadStage;
  lost?: LostReason;
  note?: string;
};

export const demoLeads: DemoLead[] = [
  {
    name: "Samir Haddad",
    phone: "0661 23 45 67",
    city: "Chéraga",
    source: "facebook",
    project: "OLIV",
    typologies: ["F3"],
    budget: "14 000 000",
    owner: "agentA",
    stage: "visit_scheduled",
  },
  {
    name: "Amina Kaci",
    phone: "0770 98 76 54",
    city: "Draria",
    source: "walk_in",
    project: "OLIV",
    typologies: ["F4"],
    budget: "19 000 000",
    owner: "agentA",
    stage: "negotiation",
    note: "Souhaite un étage élevé, orientation sud.",
  },
  {
    name: "Rachid Ould Ali",
    phone: "0550 44 21 09",
    city: "Hydra",
    source: "referral",
    project: "CORN",
    typologies: ["F5"],
    budget: "32 000 000",
    owner: "agentA",
    stage: "visited",
  },
  {
    name: "Nesrine Belaïd",
    phone: "0698 12 77 30",
    city: "Ben Aknoun",
    source: "instagram",
    project: "OLIV",
    typologies: ["F2", "F3"],
    budget: "12 500 000",
    owner: "agentA",
    stage: "contacted",
  },
  {
    name: "Mourad Zerrouki",
    phone: "0552 65 18 40",
    city: "Aïn Benian",
    source: "ouedkniss",
    project: "CORN",
    typologies: ["F3"],
    budget: "18 000 000",
    owner: "agentA",
    stage: "new",
  },
  {
    name: "Leila Mansouri",
    phone: "0661 08 91 25",
    city: "Staouéli",
    source: "facebook",
    project: "CORN",
    typologies: ["F4"],
    budget: "24 000 000",
    owner: "agentA",
    stage: "new",
  },
  {
    name: "Yacine Ferhat",
    phone: "0779 33 02 18",
    city: "Bab Ezzouar",
    source: "phone",
    project: "OLIV",
    typologies: ["F3"],
    budget: null,
    owner: "agentA",
    stage: "lost",
    lost: "financing",
    note: "Crédit bancaire refusé.",
  },
  {
    name: "Karima Boudiaf",
    phone: "0555 71 64 82",
    city: "Kouba",
    source: "whatsapp",
    project: "OLIV",
    typologies: ["F4"],
    budget: "18 500 000",
    owner: "agentA",
    stage: "won",
  },
  {
    name: "Omar Benali",
    phone: "0662 50 13 97",
    city: "Birkhadem",
    source: "website",
    project: "OLIV",
    typologies: ["F2"],
    budget: "10 000 000",
    owner: "agentA",
    stage: "contacted",
  },
  {
    name: "Sofiane Guerfi",
    phone: "0771 84 20 66",
    city: "Saïd Hamdine",
    source: "facebook",
    project: "CORN",
    typologies: ["F3", "F4"],
    budget: "22 000 000",
    owner: "agentA",
    stage: "visit_scheduled",
  },
  {
    name: "Imane Rahmani",
    phone: "0556 29 47 13",
    city: "El Achour",
    source: "instagram",
    project: "CORN",
    typologies: ["F3"],
    budget: "17 500 000",
    owner: "agentB",
    stage: "new",
  },
  {
    name: "Walid Cherfaoui",
    phone: "0664 91 38 57",
    city: "Dely Ibrahim",
    source: "walk_in",
    project: "OLIV",
    typologies: ["F4"],
    budget: "20 000 000",
    owner: "agentB",
    stage: "visited",
  },
  {
    name: "Houda Meziane",
    phone: "0772 16 59 04",
    city: "Baba Hassen",
    source: "referral",
    project: "OLIV",
    typologies: ["F3"],
    budget: "15 000 000",
    owner: "agentB",
    stage: "negotiation",
  },
  {
    name: "Tarek Aït Saïd",
    phone: "0553 87 26 71",
    city: "Tizi Ouzou",
    source: "ouedkniss",
    project: "CORN",
    typologies: ["F5"],
    budget: null,
    owner: "agentB",
    stage: "lost",
    lost: "price",
  },
  {
    name: "Selma Bouzid",
    phone: "0699 40 82 15",
    city: "Blida",
    source: "facebook",
    project: "OLIV",
    typologies: ["F2"],
    budget: "11 000 000",
    owner: "agentB",
    stage: "contacted",
  },
  {
    name: "Adel Hamidi",
    phone: "0665 02 73 38",
    city: "Chéraga",
    source: "phone",
    project: null,
    typologies: ["F3"],
    budget: null,
    owner: "agentB",
    stage: "new",
  },
  {
    name: "Farida Laïb",
    phone: "0558 36 94 20",
    city: "Paris",
    source: "whatsapp",
    project: "CORN",
    typologies: ["F4"],
    budget: "26 000 000",
    owner: "agentB",
    stage: "visit_scheduled",
    note: "Réside en France, visite pendant les vacances d'été.",
  },
  {
    name: "Nabil Khelifi",
    phone: "0773 58 11 46",
    city: "Rouiba",
    source: "website",
    project: "OLIV",
    typologies: ["F3"],
    budget: "13 500 000",
    owner: "agentB",
    stage: "lost",
    lost: "location",
  },
  {
    name: "Djamel Benchikh",
    phone: "0551 63 29 84",
    city: "Draria",
    source: "walk_in",
    project: "OLIV",
    typologies: ["F5"],
    budget: "30 000 000",
    owner: "manager",
    stage: "negotiation",
    note: "Intéressé par le duplex A-08-01.",
  },
  {
    name: "Assia Lounis",
    phone: "0667 14 85 02",
    city: "Hydra",
    source: "referral",
    project: "CORN",
    typologies: ["F4", "F5"],
    budget: "35 000 000",
    owner: "manager",
    stage: "visited",
  },
  {
    name: "Hamza Boukhari",
    phone: "0776 27 60 93",
    city: "Mohammadia",
    source: "facebook",
    project: "CORN",
    typologies: ["F3"],
    budget: null,
    owner: "none",
    stage: "new",
  },
  {
    name: "Meriem Taleb",
    phone: "0559 82 04 37",
    city: "Bordj El Kiffan",
    source: "instagram",
    project: "OLIV",
    typologies: ["F2"],
    budget: "10 500 000",
    owner: "none",
    stage: "new",
  },
  {
    name: "Riad Belkadi",
    phone: "0668 45 97 21",
    city: "Oran",
    source: "ouedkniss",
    project: null,
    typologies: ["F4"],
    budget: null,
    owner: "none",
    stage: "new",
  },
  // Duplicates: the same person came in twice (different channel or commercial).
  {
    name: "Amina K.",
    phone: "+213 770 98 76 54",
    city: "Draria",
    source: "facebook",
    project: "OLIV",
    typologies: ["F4"],
    budget: null,
    owner: "agentB",
    stage: "new",
  },
  {
    name: "Mourad Zerrouki",
    phone: "0552651840",
    city: "Aïn Benian",
    source: "phone",
    project: "CORN",
    typologies: ["F3"],
    budget: null,
    owner: "none",
    stage: "new",
  },
];

const LEAD_OWNERS = { agentA: 0, agentB: 1, manager: 2, none: 3 } as const;

/** "YYYY-MM-DDTHH:mm" in Algiers time, `days` from today (negative = past). */
function at(days: number, time: string) {
  const today = todayInAlgiers();
  const date = toCalendarDate(new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000));
  return `${date}T${time}`;
}

export async function seedCrm(
  actors: { manager: TenantCtx; agentA: TenantCtx; agentB: TenantCtx },
  projectIds: Map<string, string>,
): Promise<Map<string, string>> {
  const leadIds = new Map<string, string>();
  const creatorOf = (owner: Owner) =>
    owner === "agentA" ? actors.agentA : owner === "agentB" ? actors.agentB : actors.manager;
  let index = 0;

  for (const demo of demoLeads) {
    const creator = creatorOf(demo.owner);
    const { id } = await createLead(
      creator,
      createLeadSchema.parse({
        fullName: demo.name,
        phone: demo.phone,
        city: demo.city,
        source: demo.source,
        projectId: demo.project ? projectIds.get(demo.project) : "",
        typologies: demo.typologies,
        budget: demo.budget ?? "",
        notes: demo.note ?? "",
        assignedTo: demo.owner === "manager" ? actors.manager.userId : "",
      }),
    );
    if (!leadIds.has(demo.name)) leadIds.set(demo.name, id);
    const projectId = demo.project ? projectIds.get(demo.project) : undefined;
    const stageAt = (stage: LeadStage) =>
      ["contacted", "visit_scheduled", "visited", "negotiation", "won"].indexOf(stage);
    const reached = stageAt(demo.stage);
    const offset = LEAD_OWNERS[demo.owner] + index;
    index++;

    // A first call, done a few days ago, for every lead past "new".
    if (reached >= 0 || demo.stage === "lost") {
      const call = await createFollowUp(
        creator,
        createFollowUpSchema.parse({
          leadId: id,
          dueAt: at(-6 - (offset % 5), "10:00"),
          channel: "call",
        }),
      );
      await completeFollowUp(creator, {
        followUpId: call.id,
        outcome: "Premier contact, envoi de la plaquette.",
      });
    }
    // Visits: done in the past for visited and later, planned in the coming days otherwise.
    if (demo.stage === "visit_scheduled") {
      await scheduleVisit(
        creator,
        scheduleVisitSchema.parse({
          leadId: id,
          scheduledAt: at(1 + (offset % 6), offset % 2 === 0 ? "10:30" : "15:00"),
          projectId: projectId ?? "",
        }),
      );
    }
    if (reached >= stageAt("visited")) {
      const visit = await scheduleVisit(
        creator,
        scheduleVisitSchema.parse({
          leadId: id,
          scheduledAt: at(-3 - (offset % 3), "11:00"),
          projectId: projectId ?? "",
        }),
      );
      await updateVisit(
        creator,
        updateVisitSchema.parse({
          visitId: visit.id,
          status: "done",
          scheduledAt: at(-3 - (offset % 3), "11:00"),
          outcome: "Visite du chantier et de l'appartement témoin.",
        }),
      );
    }
    if (demo.stage === "negotiation" || demo.stage === "won" || demo.stage === "lost") {
      await changeLeadStage(
        creator,
        changeLeadStageSchema.parse({
          leadId: id,
          stage: demo.stage,
          lostReason: demo.lost ?? "",
          lostNote: demo.stage === "lost" ? (demo.note ?? "") : "",
        }),
      );
    }
    // Open follow-ups: some overdue, some today, some upcoming.
    if (demo.stage !== "won" && demo.stage !== "lost" && demo.owner !== "none") {
      const when = [-2, 0, 0, 2, 4, 7][offset % 6] ?? 1;
      await createFollowUp(
        creator,
        createFollowUpSchema.parse({
          leadId: id,
          dueAt: at(when, when === 0 ? "16:00" : "09:30"),
          channel: offset % 3 === 0 ? "whatsapp" : "call",
          note: demo.stage === "negotiation" ? "Relancer sur la proposition de prix" : "",
        }),
      );
    }
    if (demo.stage === "negotiation") {
      await addLeadNote(creator, {
        leadId: id,
        note: `Demande un échéancier jusqu'à ${addMonths(todayInAlgiers(), 24).slice(0, 4)}.`,
      });
    }
  }
  // This month's activity targets.
  await saveTargets(
    actors.manager,
    saveTargetsSchema.parse({
      month: todayInAlgiers().slice(0, 7),
      targets: [
        {
          userId: actors.agentA.userId,
          visits: "12",
          quotations: "4",
          reservations: "2",
          sales: "1",
        },
        {
          userId: actors.agentB.userId,
          visits: "10",
          quotations: "3",
          reservations: "2",
          sales: "1",
        },
        {
          userId: actors.manager.userId,
          visits: "4",
          quotations: "2",
          reservations: "1",
          sales: "1",
        },
      ],
    }),
  );
  return leadIds;
}

/** Marketing spend of the last three months (reports: cost and return per lead source). */
export async function seedMarketingSpend(manager: TenantCtx) {
  const thisMonth = todayInAlgiers().slice(0, 7);
  for (const back of [0, 1, 2]) {
    const month = addMonths(`${thisMonth}-01`, -back).slice(0, 7);
    for (const [source, amount, notes] of [
      ["facebook", "120 000", "Campagne Facebook / Instagram"],
      ["ouedkniss", "25 000", "Annonces Ouedkniss"],
    ] as const) {
      await saveMarketingSpend(
        manager,
        saveMarketingSpendSchema.parse({ month, source, amount, notes }),
      );
    }
  }
}
