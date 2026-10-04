import "server-only";

import {
  type AssemblyKind,
  type AttendanceKind,
  attendanceKinds,
  formatSharesPercent,
  type Majority,
  votingKinds,
} from "@/lib/assemblies";
import { formatDate } from "@/lib/dates";
import type { CompanyIdentity } from "@/server/organizations/settings";

import { PdfDocument } from "../document";

import { assemblyKindLabels, majorityLabels, theResidence } from "./assembly-convocation";
import { Letterhead } from "./letterhead";

/** Everything printed on the minutes (procès-verbal) of a closed assembly, already resolved. */
export type AssemblyMinutesData = {
  residenceName: string;
  residenceAddress: string;
  kind: AssemblyKind;
  heldOn: string;
  startTime: string;
  endTime: string | null;
  place: string;
  convenedAt: Date;
  chairName: string | null;
  secretaryName: string | null;
  totalShares: number;
  attendance: {
    unitCode: string;
    /** Null: a unit the company still owns. */
    coOwnerName: string | null;
    kind: AttendanceKind;
    proxyName: string | null;
    share: number;
  }[];
  resolutions: {
    position: number;
    title: string;
    titleAr: string | null;
    description: string | null;
    majority: Majority;
    for: number;
    against: number;
    abstain: number;
    adopted: boolean;
    /** "A-03-02 (Benali Omar)" */
    opponents: string[];
    abstainers: string[];
  }[];
};

export const attendanceKindLabels: Record<AttendanceKind, { fr: string; ar: string }> = {
  present: { fr: "Présent", ar: "حاضر" },
  represented: { fr: "Représenté", ar: "ممثَّل" },
  absent: { fr: "Absent", ar: "غائب" },
};

const PROMOTER = { fr: "Promoteur (lot non attribué)", ar: "المرقي (وحدة غير مخصصة)" };

const CSS = `
@page{size:A4;margin:16mm}
.title{border-block:1pt solid #171717;padding:6pt 0;margin-bottom:12pt;text-align:center}
.title h1{font-size:14pt;margin:0}
h2{font-size:11pt;margin:14pt 0 4pt}
b{font-weight:600}
p{margin:0 0 6pt}
.box{border:1pt solid #d4d4d4;border-radius:4pt;padding:8pt;margin:10pt 0}
.resolution{border-top:0.75pt solid #d4d4d4;padding-top:6pt;margin-top:10pt;break-inside:avoid}
.description{white-space:pre-line}
.result{font-weight:700}
table{width:100%;border-collapse:collapse;margin:6pt 0}
th,td{border-bottom:0.75pt solid #d4d4d4;padding:3pt 6pt;text-align:start}
th{font-size:8.5pt;color:#525252;font-weight:600}
td.num,th.num{text-align:end;white-space:nowrap}
tfoot td{font-weight:700;border-bottom:none}
table.summary{width:auto;min-width:60%}
.signatures{display:flex;justify-content:space-between;gap:24pt;margin-top:28pt;break-inside:avoid}
.signatures div{flex:1;border-top:1pt solid #a3a3a3;padding-top:4pt}
.annex{break-before:page}
`;

function Bilingual({ fr, ar }: { fr: React.ReactNode; ar: React.ReactNode }) {
  return (
    <>
      <p>{fr}</p>
      <p dir="rtl" lang="ar">
        {ar}
      </p>
    </>
  );
}

/** Bilingual minutes of a general assembly: bureau, attendance, each vote and its result. */
export function AssemblyMinutesTemplate({
  data,
  company,
}: {
  data: AssemblyMinutesData;
  company: CompanyIdentity;
}) {
  const kind = assemblyKindLabels[data.kind];
  const voting = data.attendance.filter((a) => votingKinds.includes(a.kind));
  const count = (k: AttendanceKind) => data.attendance.filter((a) => a.kind === k);
  const shares = (rows: { share: number }[]) => rows.reduce((sum, r) => sum + r.share, 0);
  const votingShares = shares(voting);
  return (
    <PdfDocument title={`PV ${data.residenceName} ${data.heldOn}`} css={CSS}>
      <Letterhead company={company} />

      <div className="title">
        <h1>PROCÈS-VERBAL DE L&apos;ASSEMBLÉE GÉNÉRALE {kind.fr.toUpperCase()}</h1>
        <h1 dir="rtl" lang="ar">
          محضر الجمعية العامة {kind.ar}
        </h1>
        <div className="muted">
          {data.residenceName}
          {data.residenceAddress ? ` · ${data.residenceAddress}` : ""}
        </div>
      </div>

      <Bilingual
        fr={
          <>
            Le <b>{formatDate(data.heldOn)}</b> à <b dir="ltr">{data.startTime}</b>, les
            copropriétaires de <b>{theResidence(data.residenceName)}</b> se sont réunis en assemblée
            générale {kind.fr}, {data.place}, sur convocation adressée le{" "}
            {formatDate(data.convenedAt)}.
          </>
        }
        ar={
          <>
            في يوم <b>{formatDate(data.heldOn)}</b> على الساعة <b dir="ltr">{data.startTime}</b>،
            اجتمع الملاك المشتركون في إقامة <bdi>{data.residenceName}</bdi> في الجمعية العامة{" "}
            {kind.ar}، <bdi>{data.place}</bdi>، بناءً على الاستدعاء الموجه بتاريخ{" "}
            {formatDate(data.convenedAt)}.
          </>
        }
      />
      <Bilingual
        fr={
          <>
            Président de séance : <b>{data.chairName ?? "—"}</b>
            {data.secretaryName ? (
              <>
                {" "}
                · Secrétaire : <b>{data.secretaryName}</b>
              </>
            ) : null}
          </>
        }
        ar={
          <>
            رئيس الجلسة: <b>{data.chairName ? <bdi>{data.chairName}</bdi> : "—"}</b>
            {data.secretaryName ? (
              <>
                {" "}
                · كاتب الجلسة:{" "}
                <b>
                  <bdi>{data.secretaryName}</bdi>
                </b>
              </>
            ) : null}
          </>
        }
      />

      <div className="box">
        <Bilingual
          fr={
            <>
              Lots présents ou représentés : <b>{voting.length}</b> sur {data.attendance.length},
              totalisant <b dir="ltr">{votingShares}</b> tantièmes sur{" "}
              <span dir="ltr">{data.totalShares}</span> (
              {formatSharesPercent(votingShares, data.totalShares)}).
            </>
          }
          ar={
            <>
              الوحدات الحاضرة أو الممثلة: <b>{voting.length}</b> من أصل {data.attendance.length}،
              مجموع حصصها <b dir="ltr">{votingShares}</b> من أصل{" "}
              <span dir="ltr">{data.totalShares}</span> (
              <span dir="ltr">{formatSharesPercent(votingShares, data.totalShares)}</span>).
            </>
          }
        />
        <table className="summary">
          <thead>
            <tr>
              <th>
                Présence · <span lang="ar">الحضور</span>
              </th>
              <th className="num">
                Lots · <span lang="ar">الوحدات</span>
              </th>
              <th className="num">
                Tantièmes · <span lang="ar">الحصص</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {attendanceKinds.map((k) => (
              <tr key={k}>
                <td>
                  {attendanceKindLabels[k].fr} · <span lang="ar">{attendanceKindLabels[k].ar}</span>
                </td>
                <td className="num">{count(k).length}</td>
                <td className="num">{shares(count(k))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          Les votes sont comptés en tantièmes · <span lang="ar">تُحتسب الأصوات بالحصص</span>
        </p>
      </div>

      <h2>
        Délibérations · <span lang="ar">المداولات</span>
      </h2>
      {data.resolutions.map((r) => (
        <div key={r.position} className="resolution">
          <p>
            <b>
              Résolution n° {r.position} : {r.title}
            </b>
          </p>
          {r.titleAr ? (
            <p dir="rtl" lang="ar">
              <b>
                القرار رقم {r.position}: <bdi>{r.titleAr}</bdi>
              </b>
            </p>
          ) : null}
          {r.description ? <p className="description">{r.description}</p> : null}
          <p className="muted">
            Majorité requise : {majorityLabels[r.majority].fr} ·{" "}
            <span lang="ar">الأغلبية المطلوبة: {majorityLabels[r.majority].ar}</span>
          </p>
          <table>
            <thead>
              <tr>
                <th className="num">
                  Pour · <span lang="ar">مؤيد</span>
                </th>
                <th className="num">
                  Contre · <span lang="ar">معارض</span>
                </th>
                <th className="num">
                  Abstention · <span lang="ar">امتناع</span>
                </th>
                <th className="num">
                  Total · <span lang="ar">المجموع</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="num" dir="ltr">
                  {r.for}
                </td>
                <td className="num" dir="ltr">
                  {r.against}
                </td>
                <td className="num" dir="ltr">
                  {r.abstain}
                </td>
                <td className="num" dir="ltr">
                  {data.totalShares}
                </td>
              </tr>
            </tbody>
          </table>
          {r.opponents.length > 0 ? (
            <p className="muted">
              Ont voté contre · <span lang="ar">صوّت ضد</span> : {r.opponents.join(", ")}
            </p>
          ) : null}
          {r.abstainers.length > 0 ? (
            <p className="muted">
              Se sont abstenus · <span lang="ar">امتنع عن التصويت</span> : {r.abstainers.join(", ")}
            </p>
          ) : null}
          <p className="result">
            {r.adopted ? "Résolution adoptée" : "Résolution rejetée"} ·{" "}
            <span lang="ar">{r.adopted ? "القرار مقبول" : "القرار مرفوض"}</span>
          </p>
        </div>
      ))}

      <div className="box">
        <Bilingual
          fr={
            data.endTime ? (
              <>
                L&apos;ordre du jour étant épuisé, la séance est levée à{" "}
                <b dir="ltr">{data.endTime}</b>.
              </>
            ) : (
              <>L&apos;ordre du jour étant épuisé, la séance est levée.</>
            )
          }
          ar={
            data.endTime ? (
              <>
                وبعد استنفاد جدول الأعمال، رُفعت الجلسة على الساعة <b dir="ltr">{data.endTime}</b>.
              </>
            ) : (
              <>وبعد استنفاد جدول الأعمال، رُفعت الجلسة.</>
            )
          }
        />
      </div>

      <div className="signatures">
        <div className="muted">Le président de séance · رئيس الجلسة</div>
        {data.secretaryName ? <div className="muted">Le secrétaire · كاتب الجلسة</div> : null}
      </div>

      <div className="annex">
        <h2>
          Annexe : feuille de présence · <span lang="ar">ملحق: ورقة الحضور</span>
        </h2>
        <table>
          <thead>
            <tr>
              <th>
                Lot · <span lang="ar">الوحدة</span>
              </th>
              <th>
                Copropriétaire · <span lang="ar">المالك المشترك</span>
              </th>
              <th>
                Présence · <span lang="ar">الحضور</span>
              </th>
              <th>
                Mandataire · <span lang="ar">الوكيل</span>
              </th>
              <th className="num">
                Tantièmes · <span lang="ar">الحصص</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.attendance.map((a) => (
              <tr key={a.unitCode}>
                <td dir="ltr">{a.unitCode}</td>
                <td>
                  {a.coOwnerName ?? (
                    <>
                      {PROMOTER.fr} · <span lang="ar">{PROMOTER.ar}</span>
                    </>
                  )}
                </td>
                <td>
                  {attendanceKindLabels[a.kind].fr} ·{" "}
                  <span lang="ar">{attendanceKindLabels[a.kind].ar}</span>
                </td>
                <td>{a.proxyName ?? ""}</td>
                <td className="num" dir="ltr">
                  {a.share}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>
                Total · <span lang="ar">المجموع</span>
              </td>
              <td className="num" dir="ltr">
                {data.totalShares}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </PdfDocument>
  );
}
