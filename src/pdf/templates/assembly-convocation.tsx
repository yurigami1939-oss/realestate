import "server-only";

import type { AssemblyKind, Majority } from "@/lib/assemblies";
import { formatDate } from "@/lib/dates";
import type { CompanyIdentity } from "@/server/organizations/settings";

import { PdfDocument } from "../document";

import { Letterhead } from "./letterhead";

/** Everything printed on a convocation, already resolved. */
export type AssemblyConvocationData = {
  residenceName: string;
  residenceAddress: string;
  kind: AssemblyKind;
  heldOn: string;
  startTime: string;
  place: string;
  convenedAt: Date;
  agenda: { position: number; title: string; titleAr: string | null; majority: Majority }[];
};

export const assemblyKindLabels: Record<AssemblyKind, { fr: string; ar: string }> = {
  ordinary: { fr: "ordinaire", ar: "العادية" },
  extraordinary: { fr: "extraordinaire", ar: "غير العادية" },
};

/** "la résidence Les Oliviers", or "la Résidence Les Oliviers" when the name already says so. */
export function theResidence(name: string): string {
  return /^r[ée]sidence\s/i.test(name) ? `la ${name}` : `la résidence ${name}`;
}

export const majorityLabels: Record<Majority, { fr: string; ar: string }> = {
  simple: { fr: "Majorité des voix exprimées", ar: "أغلبية الأصوات المعبر عنها" },
  absolute: { fr: "Majorité absolue des tantièmes", ar: "الأغلبية المطلقة للحصص" },
  two_thirds: { fr: "Majorité des deux tiers des tantièmes", ar: "أغلبية ثلثي الحصص" },
  unanimity: { fr: "Unanimité", ar: "الإجماع" },
};

const CSS = `
@page{size:A4;margin:16mm}
.title{border-block:1pt solid #171717;padding:6pt 0;margin-bottom:12pt;text-align:center}
.title h1{font-size:14pt;margin:0}
b{font-weight:600}
p{margin:0 0 6pt}
ol{margin:6pt 0 10pt;padding-inline-start:18pt}
li{margin-bottom:5pt}
.majority{font-size:8.5pt;color:#525252}
.box{border:1pt solid #d4d4d4;border-radius:4pt;padding:8pt;margin:10pt 0}
.signatures{display:flex;justify-content:flex-end;margin-top:28pt}
.signatures div{width:40%;border-top:1pt solid #a3a3a3;padding-top:4pt}
`;

/** Bilingual convocation of the co-owners to a general assembly, with its agenda. */
export function AssemblyConvocationTemplate({
  data,
  company,
}: {
  data: AssemblyConvocationData;
  company: CompanyIdentity;
}) {
  const kind = assemblyKindLabels[data.kind];
  return (
    <PdfDocument title={`Convocation ${data.residenceName}`} css={CSS}>
      <Letterhead company={company} />

      <div className="title">
        <h1>CONVOCATION À L&apos;ASSEMBLÉE GÉNÉRALE {kind.fr.toUpperCase()}</h1>
        <h1 dir="rtl" lang="ar">
          استدعاء إلى الجمعية العامة {kind.ar}
        </h1>
        <div className="muted">Le {formatDate(data.convenedAt)}</div>
      </div>

      <p>
        <b>Mesdames et Messieurs les copropriétaires de {theResidence(data.residenceName)}</b>
        {data.residenceAddress ? ` (${data.residenceAddress})` : ""},
      </p>
      <p>
        Vous êtes convoqués à l&apos;assemblée générale {kind.fr} des copropriétaires qui se tiendra
        le <b>{formatDate(data.heldOn)}</b> à <b dir="ltr">{data.startTime}</b>, {data.place}, avec
        l&apos;ordre du jour suivant :
      </p>
      <p dir="rtl" lang="ar">
        <b>
          السيدات والسادة الملاك المشتركون في إقامة <bdi>{data.residenceName}</bdi>
        </b>
        ، تُستدعون لحضور الجمعية العامة {kind.ar} للملاك المشتركين التي ستنعقد يوم{" "}
        <b>{formatDate(data.heldOn)}</b> على الساعة <b dir="ltr">{data.startTime}</b>،{" "}
        <bdi>{data.place}</bdi>، وفق جدول الأعمال التالي:
      </p>

      <ol>
        {data.agenda.map((item) => (
          <li key={item.position}>
            <b>{item.title}</b>
            {item.titleAr ? (
              <>
                {" · "}
                <bdi dir="rtl" lang="ar">
                  {item.titleAr}
                </bdi>
              </>
            ) : null}
            <div className="majority">
              {majorityLabels[item.majority].fr} ·{" "}
              <span lang="ar">{majorityLabels[item.majority].ar}</span>
            </div>
          </li>
        ))}
      </ol>

      <div className="box">
        <p>
          Tout copropriétaire empêché peut se faire représenter par un mandataire de son choix, muni
          d&apos;un pouvoir écrit et signé. Les votes sont comptés en tantièmes.
        </p>
        <p dir="rtl" lang="ar">
          يمكن لكل مالك مشترك متعذر عليه الحضور أن يُنيب عنه وكيلاً من اختياره بموجب توكيل مكتوب
          وموقع. وتُحتسب الأصوات بالحصص.
        </p>
      </div>

      <div className="signatures">
        <div className="muted">Le gestionnaire · المسير</div>
      </div>
    </PdfDocument>
  );
}
