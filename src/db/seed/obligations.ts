import { addDays, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { createProjectDocumentSchema } from "@/server/obligations/schemas";
import { createProjectDocument } from "@/server/obligations/service";

type DocumentSpec = {
  kind: string;
  reference: string;
  issuedOn: string;
  expiresOn?: string;
  issuer: string;
  title?: string;
};

/**
 * The regulatory files of the projects on sale: Les Oliviers holds every essential document,
 * its insurance to renew within the month; La Corniche, still in planning, only its permit
 * and its land title (dashboard to-dos for the gérant).
 */
export async function seedObligations(owner: TenantCtx, projectIds: Map<string, string>) {
  const today = todayInAlgiers();
  const files: [string, DocumentSpec[]][] = [
    [
      "OLIV",
      [
        {
          kind: "land_title",
          reference: "Livret foncier 16/2219",
          issuedOn: "2022-05-18",
          issuer: "Conservation foncière de Bir Mourad Raïs",
        },
        {
          kind: "building_permit",
          reference: "PC 16/0987/2024",
          issuedOn: "2024-03-12",
          issuer: "APC de Draria",
        },
        {
          kind: "technical_control",
          reference: "CTC/ALG/2024/0311",
          issuedOn: "2024-04-02",
          issuer: "CTC Centre",
        },
        {
          kind: "insurance",
          reference: "Police RC 24-778-0315",
          issuedOn: addDays(today, -335),
          expiresOn: addDays(today, 30),
          issuer: "CAAR",
        },
        {
          kind: "fgcmpi",
          reference: "FGCMPI-16-0482",
          issuedOn: "2024-05-06",
          issuer: "FGCMPI",
        },
      ],
    ],
    [
      "CORN",
      [
        {
          kind: "land_title",
          reference: "Acte notarié 2025/1187",
          issuedOn: "2025-02-10",
          issuer: "Maître Ouali Rym",
        },
        {
          kind: "building_permit",
          reference: "PC 16/1422/2025",
          issuedOn: "2025-11-20",
          issuer: "APC d'Aïn Benian",
        },
      ],
    ],
  ];
  for (const [code, documents] of files) {
    const projectId = projectIds.get(code);
    if (!projectId) throw new Error(`seed: project ${code} missing`);
    for (const d of documents) {
      await createProjectDocument(
        owner,
        createProjectDocumentSchema.parse({
          projectId,
          kind: d.kind,
          title: d.title ?? "",
          reference: d.reference,
          issuedOn: d.issuedOn,
          expiresOn: d.expiresOn ?? "",
          issuer: d.issuer,
          notes: "",
        }),
      );
    }
  }
}
