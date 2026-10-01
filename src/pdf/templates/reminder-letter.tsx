import "server-only";

import { formatDate } from "@/lib/dates";
import { amountInWordsAr, amountInWordsFr, type Centimes, formatDZD } from "@/lib/money";
import type { CompanyIdentity } from "@/server/organizations/settings";

import { PdfDocument } from "../document";

import { Letterhead } from "./letterhead";

/** Everything printed on a reminder letter, already resolved (no lookups in templates). */
export type ReminderLetterData = {
  issuedAt: Date;
  saleNumber: string;
  saleDeedNumber: string | null;
  projectName: string;
  unitCode: string;
  payBy: string;
  overdue: Centimes;
  penalties: Centimes;
  lines: {
    label: string;
    dueOn: string;
    remaining: Centimes;
    daysLate: number;
    penalty: Centimes;
  }[];
  buyers: { name: string; nameAr: string | null; address: string }[];
};

const CSS = `
@page{size:A4;margin:16mm}
header{display:flex;justify-content:space-between;gap:16pt;margin-bottom:12pt}
.org{font-size:13pt;font-weight:700}
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

/** Bilingual reminder letter (lettre de relance) for overdue installments. */
export function ReminderLetterTemplate({
  data,
  company,
}: {
  data: ReminderLetterData;
  company: CompanyIdentity;
}) {
  const money = (v: Centimes) => formatDZD(v, "fr");
  const contract = data.saleDeedNumber
    ? `VSP ${data.saleDeedNumber} (réservation ${data.saleNumber})`
    : `réservation ${data.saleNumber}`;
  const showPenalties = data.penalties > 0n;
  return (
    <PdfDocument title={`Relance ${data.saleNumber}`} css={CSS}>
      <Letterhead company={company} />

      <div className="title">
        <h1>LETTRE DE RELANCE</h1>
        <div className="muted">Le {formatDate(data.issuedAt)}</div>
        <h1 dir="rtl" lang="ar">
          رسالة تذكير
        </h1>
      </div>

      <div className="to">
        {data.buyers.map((b) => (
          <div key={b.name}>
            <b>{b.name}</b>
            {b.nameAr ? (
              <>
                {" · "}
                <bdi dir="rtl" lang="ar">
                  {b.nameAr}
                </bdi>
              </>
            ) : null}
            {b.address ? <div className="muted">{b.address}</div> : null}
          </div>
        ))}
      </div>

      <div className="box">
        <p>
          <b>Objet :</b> échéances impayées · {data.projectName} · lot{" "}
          <b dir="ltr">{data.unitCode}</b> · {contract}
        </p>
        <p dir="rtl" lang="ar">
          <b>الموضوع:</b> دفعات غير مسددة · <bdi>{data.projectName}</bdi> · الوحدة{" "}
          <bdi>{data.unitCode}</bdi> · الحجز <bdi>{data.saleNumber}</bdi>
        </p>
      </div>

      <p>
        Sauf erreur de notre part, les échéances ci-dessous de votre échéancier restent impayées à
        ce jour. Nous vous prions de bien vouloir régulariser votre situation au plus tard le{" "}
        <b>{formatDate(data.payBy)}</b>. Si votre règlement a été effectué entre-temps, veuillez ne
        pas tenir compte de la présente.
      </p>
      <p dir="rtl" lang="ar">
        ما لم يكن هناك خطأ من جهتنا، تبقى الدفعات المبينة أدناه من جدول دفعاتكم غير مسددة إلى يومنا
        هذا. نرجو منكم تسوية وضعيتكم في أجل أقصاه <b>{formatDate(data.payBy)}</b>. وإذا تمّ التسديد
        في الأثناء، فالرجاء عدم اعتبار هذه الرسالة.
      </p>

      <table>
        <thead>
          <tr>
            <th>
              Échéance · <span lang="ar">الدفعة</span>
            </th>
            <th>
              Exigible le · <span lang="ar">تاريخ الاستحقاق</span>
            </th>
            <th className="num">
              Retard · <span lang="ar">التأخير</span>
            </th>
            <th className="num">
              Reste dû · <span lang="ar">المبلغ المتبقي</span>
            </th>
            {showPenalties ? (
              <th className="num">
                Pénalité · <span lang="ar">الغرامة</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line) => (
            <tr key={`${line.label}-${line.dueOn}`}>
              <td>
                <bdi>{line.label}</bdi>
              </td>
              <td dir="ltr">{formatDate(line.dueOn)}</td>
              <td className="num">
                {line.daysLate} j · <span lang="ar">يوم</span>
              </td>
              <td className="num" dir="ltr">
                {money(line.remaining)}
              </td>
              {showPenalties ? (
                <td className="num" dir="ltr">
                  {money(line.penalty)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Total · المجموع</td>
            <td className="num" dir="ltr">
              {money(data.overdue)}
            </td>
            {showPenalties ? (
              <td className="num" dir="ltr">
                {money(data.penalties)}
              </td>
            ) : null}
          </tr>
        </tfoot>
      </table>

      <p>Soit : {amountInWordsFr(data.overdue)}.</p>
      <p dir="rtl" lang="ar">
        أي: {amountInWordsAr(data.overdue)}.
      </p>
      {showPenalties ? (
        <>
          <p className="muted">
            Les pénalités de retard sont indiquées à titre d&apos;information, conformément aux
            conditions de votre contrat.
          </p>
          <p className="muted" dir="rtl" lang="ar">
            غرامات التأخير مذكورة على سبيل الإعلام، وفقاً لشروط عقدكم.
          </p>
        </>
      ) : null}

      <div className="signatures">
        <div className="muted">Le promoteur · المرقي</div>
      </div>
    </PdfDocument>
  );
}
