/**
 * Demo construction follow-up (module 4): the responsable technique's progress reports with
 * site photos — Les Oliviers (three published, one internal), the start of the works at La
 * Corniche and the end of the works at Les Amandiers. Dated relative to today (Algiers).
 */
import { addDays, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { getProjectConstruction } from "@/server/construction/queries";
import { createReportSchema } from "@/server/construction/schemas";
import { addReportPhoto, createConstructionReport } from "@/server/construction/service";

import { sitePhoto } from "./photos";

const need = (map: Map<string, string>, key: string) => {
  const value = map.get(key);
  if (!value) throw new Error(`seed: ${key} missing`);
  return value;
};

type ReportSpec = {
  daysAgo: number;
  title: string;
  titleAr?: string;
  body: string;
  bodyAr?: string;
  published?: boolean;
  /** Progress per building name, in percent. */
  progress: Record<string, number>;
  /** Photos: storeys of the building drawn and the progress shown on each. */
  photos?: { floors: number; percent: number }[];
};

async function seedProject(technical: TenantCtx, projectId: string, reports: ReportSpec[]) {
  const project = await getProjectConstruction(technical, projectId);
  if (!project) throw new Error("seed: project missing");
  const today = todayInAlgiers();
  for (const spec of reports) {
    const { id } = await createConstructionReport(
      technical,
      createReportSchema.parse({
        projectId,
        reportedOn: addDays(today, -spec.daysAgo),
        title: spec.title,
        titleAr: spec.titleAr ?? "",
        body: spec.body,
        bodyAr: spec.bodyAr ?? "",
        published: spec.published ?? true,
        progress: project.buildings.map((b) => ({
          buildingId: b.id,
          percent: spec.progress[b.name] === undefined ? "" : String(spec.progress[b.name]),
        })),
      }),
    );
    for (const [index, photo] of (spec.photos ?? []).entries()) {
      await addReportPhoto(technical, {
        reportId: id,
        upload: {
          fileName: `chantier-${addDays(today, -spec.daysAgo)}-${index + 1}.png`,
          bytes: sitePhoto({ ...photo, variant: index }),
        },
      });
    }
  }
}

export async function seedConstruction(technical: TenantCtx, projects: Map<string, string>) {
  await seedProject(technical, need(projects, "OLIV"), [
    {
      daysAgo: 70,
      title: "Dalle du 3e étage coulée",
      titleAr: "صب بلاطة الطابق الثالث",
      body: "Le gros œuvre avance comme prévu : la dalle du 3e étage du bloc A est coulée, le bloc B atteint le 2e étage.",
      bodyAr:
        "تتقدم أشغال الهيكل كما هو مقرر: صُبّت بلاطة الطابق الثالث في العمارة A، وبلغت العمارة B الطابق الثاني.",
      progress: { "Bloc A": 38, "Bloc B": 27 },
      photos: [{ floors: 9, percent: 38 }],
    },
    {
      daysAgo: 35,
      title: "Dernières dalles du bloc A",
      titleAr: "آخر بلاطات العمارة A",
      body: "Coulage des dernières dalles du bloc A ; le bloc B atteint le 5e étage. Les réseaux sont posés au sous-sol.",
      bodyAr:
        "صب آخر بلاطات العمارة A، وبلغت العمارة B الطابق الخامس. تم تمديد الشبكات في الطابق السفلي.",
      progress: { "Bloc A": 55, "Bloc B": 42 },
      photos: [
        { floors: 9, percent: 55 },
        { floors: 9, percent: 42 },
      ],
    },
    {
      daysAgo: 10,
      title: "Gros œuvre achevé",
      titleAr: "انتهاء أشغال الهيكل",
      body: "Le gros œuvre des deux blocs est achevé. La maçonnerie intérieure et l'étanchéité des terrasses commencent.",
      bodyAr: "انتهت أشغال هيكل العمارتين، وتنطلق أشغال البناء الداخلي وعزل الأسطح.",
      progress: { "Bloc A": 64, "Bloc B": 56 },
      photos: [{ floors: 9, percent: 64 }],
    },
    {
      daysAgo: 2,
      title: "Réunion de chantier : menuiseries",
      body: "Le menuisier annonce trois semaines de retard sur les fenêtres ; relance écrite envoyée, pénalités à discuter.",
      published: false,
      progress: {},
    },
  ]);
  await seedProject(technical, need(projects, "CORN"), [
    {
      daysAgo: 20,
      title: "Installation du chantier",
      titleAr: "تهيئة الورشة",
      body: "Clôture, base vie et terrassement en cours ; les fondations commencent le mois prochain.",
      bodyAr: "السياج وقاعدة الحياة وأشغال الحفر جارية؛ تنطلق الأساسات الشهر القادم.",
      progress: { "Bloc C": 5 },
    },
  ]);
  await seedProject(technical, need(projects, "AMND"), [
    {
      daysAgo: 60,
      title: "Second œuvre",
      titleAr: "أشغال التشطيب",
      body: "Carrelage, menuiseries et peinture en cours dans tous les logements ; façades terminées.",
      bodyAr: "أشغال التبليط والنجارة والطلاء جارية في كل المساكن؛ انتهت الواجهات.",
      progress: { "Bloc D": 85 },
      photos: [{ floors: 4, percent: 85 }],
    },
    {
      daysAgo: 8,
      title: "Bâtiment achevé",
      titleAr: "انتهاء أشغال البناية",
      body: "Les travaux sont achevés et les parties communes nettoyées : les remises de clés commencent.",
      bodyAr: "انتهت الأشغال ونُظّفت الأجزاء المشتركة: تنطلق عمليات تسليم المفاتيح.",
      progress: { "Bloc D": 100 },
      photos: [{ floors: 4, percent: 100 }],
    },
  ]);
}
