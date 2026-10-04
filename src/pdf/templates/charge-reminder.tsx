import "server-only";

import { formatDate } from "@/lib/dates";
import { amountInWordsAr, amountInWordsFr, type Centimes, formatDZD } from "@/lib/money";
import type { CompanyIdentity } from "@/server/organizations/settings";

import { PdfDocument } from "../document";

import { Letterhead } from "./letterhead";

/** Everything printed on a charges reminder letter, already resolved. */
export type ChargeReminderData = {
  issuedAt: Date;
  residenceName: string;
  residenceAddress: string;
  unitCode: string;
  payBy: string;
  overdue: Centimes;
  lines: {
    number: string;
    period: { fr: string; ar: string };
    dueOn: string;
    remaining: Centimes;
    daysLate: number;
  }[];
  /** Null: no co-owner (a unit the company still owns). */
  addressee: { name: string; nameAr: string | null; address: string | null } | null;
};

const CSS = `
@page{size:A4;margin:16mm}
.title{display:flex;justify-content:space-between;align-items:center;border-block:1pt solid #171717;padding:6pt 0;margin-bottom:12pt}
.title h1{font-size:15pt;margin:0}
.to{margin:0 0 12pt auto;width:55%}
.box{border:1pt solid #d4d4d4;border-radius:4pt;padding:8pt;margin-bottom:10pt}
b{font-weight:600}
p{margin:0 0 6pt}
table{width:100%;border-collapse:collapse;margin:8pt 0}
th,td{border-bottom:0.75pt solid #d4d4d4;padding:4pt 6pt;text-align:start}
th{font-size:8.5pt;color:#525252;font-weight:600}
td.num,th.num{text-align:end;white-space:nowrap}
tfoot td{font-weight:700;border-bottom:none}
.signatures{display:flex;justify-content:flex-end;margin-top:28pt}
.signatures div{width:40%;border-top:1pt solid #a3a3a3;padding-top:4pt}
`;

/** Bilingual reminder letter for a unit's overdue charges (no penalties on charges). */
export function ChargeReminderTemplate({
  data,
  company,
}: {
  data: ChargeReminderData;
  company: CompanyIdentity;
}) {
  const money = (v: Centimes) => formatDZD(v, "fr");
  return (
    <PdfDocument title={`Relance ${data.unitCode}`} css={CSS}>
      <Letterhead company={company} />

      <div className="title">
        <h1>LETTRE DE RELANCE — CHARGES</h1>
        <div className="muted">Le {formatDate(data.issuedAt)}</div>
        <h1 dir="rtl" lang="ar">
          رسالة تذكير بالأعباء
        </h1>
      </div>

      <div className="to">
        {data.addressee ? (
          <>
            <b>{data.addressee.name}</b>
            {data.addressee.nameAr ? (
              <>
                {" · "}
                <bdi dir="rtl" lang="ar">
                  {data.addressee.nameAr}
                </bdi>
              </>
            ) : null}
            <div className="muted">
              {data.addressee.address ??
                `${data.residenceName}, lot ${data.unitCode}${data.residenceAddress ? `, ${data.residenceAddress}` : ""}`}
            </div>
          </>
        ) : (
          <>
            <b>Lot non attribué — à la charge du promoteur</b>
            <div className="muted" dir="rtl" lang="ar">
              وحدة غير مخصصة — على عاتق المرقي
            </div>
          </>
        )}
      </div>

      <div className="box">
        <p>
          <b>Objet :</b> charges de copropriété impayées · {data.residenceName} · lot{" "}
          <b dir="ltr">{data.unitCode}</b>
        </p>
        <p dir="rtl" lang="ar">
          <b>الموضوع:</b> أعباء الملكية المشتركة غير المسددة · <bdi>{data.residenceName}</bdi> ·
          الوحدة <bdi>{data.unitCode}</bdi>
        </p>
      </div>

      <p>
        Sauf erreur de notre part, les appels de charges ci-dessous restent impayés à ce jour. Nous
        vous prions de bien vouloir régler la somme de <b>{money(data.overdue)}</b> au plus tard le{" "}
        <b>{formatDate(data.payBy)}</b>. Si votre règlement a été effectué entre-temps, veuillez ne
        pas tenir compte de ce courrier.
      </p>
      <p dir="rtl" lang="ar">
        ما لم يكن هناك خطأ من جهتنا، تبقى طلبات الأعباء المبينة أدناه غير مسددة إلى غاية اليوم. نرجو
        منكم تسديد مبلغ <b dir="ltr">{money(data.overdue)}</b> في أجل أقصاه{" "}
        <b>{formatDate(data.payBy)}</b>. وإذا تم التسديد في الأثناء، فالرجاء عدم الاعتداد بهذه
        الرسالة.
      </p>

      <table>
        <thead>
          <tr>
            <th>
              Appel · <span lang="ar">الطلب</span>
            </th>
            <th>
              Période · <span lang="ar">الفترة</span>
            </th>
            <th>
              Échéance · <span lang="ar">آخر أجل</span>
            </th>
            <th className="num">
              Retard · <span lang="ar">التأخر</span>
            </th>
            <th className="num">
              Impayé · <span lang="ar">غير المسدد</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line) => (
            <tr key={line.number}>
              <td dir="ltr">{line.number}</td>
              <td>
                {line.period.fr} ·{" "}
                <bdi dir="rtl" lang="ar">
                  {line.period.ar}
                </bdi>
              </td>
              <td>{formatDate(line.dueOn)}</td>
              <td className="num">
                {line.daysLate} j · <span lang="ar">يوم</span>
              </td>
              <td className="num" dir="ltr">
                {money(line.remaining)}
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
              {money(data.overdue)}
            </td>
          </tr>
        </tfoot>
      </table>
      <p>Soit : {amountInWordsFr(data.overdue)}.</p>
      <p dir="rtl" lang="ar">
        أي: {amountInWordsAr(data.overdue)}.
      </p>

      <div className="signatures">
        <div className="muted">Le gestionnaire · المسير</div>
      </div>
    </PdfDocument>
  );
}
