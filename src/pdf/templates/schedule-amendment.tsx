import "server-only";

import { formatDate } from "@/lib/dates";
import { amountInWordsAr, amountInWordsFr, type Centimes, formatDZD } from "@/lib/money";
import type { CompanyIdentity } from "@/server/organizations/settings";

import { PdfDocument } from "../document";

import { Letterhead } from "./letterhead";

type Line = { label: string; amount: Centimes; dueOn: string | null; milestoneName: string | null };

/** Everything printed on a schedule amendment, already resolved (no lookups in templates). */
export type ScheduleAmendmentData = {
  sequence: number;
  signedOn: string;
  reason: string;
  saleNumber: string;
  saleDeedNumber: string | null;
  reservedOn: string;
  projectName: string;
  unitCode: string;
  price: Centimes;
  paid: Centimes;
  replaced: Line[];
  lines: Line[];
  buyers: { name: string; nameAr: string | null; nin: string | null }[];
};

const CSS = `
@page{size:A4;margin:16mm}
.title{display:flex;justify-content:space-between;align-items:center;border-block:1pt solid #171717;padding:6pt 0;margin-bottom:12pt}
.title h1{font-size:15pt;margin:0}
.box{border:1pt solid #d4d4d4;border-radius:4pt;padding:8pt;margin-bottom:10pt}
b{font-weight:600}
p{margin:0 0 6pt}
h2{font-size:11pt;margin:12pt 0 4pt}
table{width:100%;border-collapse:collapse;margin:4pt 0 8pt}
th,td{border-bottom:0.75pt solid #d4d4d4;padding:4pt 6pt;text-align:start}
th{font-size:8.5pt;color:#525252;font-weight:600}
td.num,th.num{text-align:end;white-space:nowrap}
tfoot td{font-weight:700;border-bottom:none}
.old td{color:#525252}
.signatures{display:flex;justify-content:space-between;margin-top:28pt}
.signatures div{width:45%;border-top:1pt solid #a3a3a3;padding-top:4pt}
`;

const total = (lines: Line[]) => lines.reduce((sum, l) => sum + l.amount, 0n);

function due(line: Line) {
  if (line.dueOn) return formatDate(line.dueOn);
  return `À l'achèvement : ${line.milestoneName ?? "—"} · عند إنجاز المرحلة`;
}

function Lines({ lines, className }: { lines: Line[]; className?: string }) {
  const money = (v: Centimes) => formatDZD(v, "fr");
  return (
    <table className={className}>
      <thead>
        <tr>
          <th>
            Échéance · <span lang="ar">الدفعة</span>
          </th>
          <th>
            Exigible · <span lang="ar">الاستحقاق</span>
          </th>
          <th className="num">
            Montant · <span lang="ar">المبلغ</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => (
          <tr key={`${index}-${line.label}`}>
            <td>
              <bdi>{line.label}</bdi>
            </td>
            <td>
              <bdi>{due(line)}</bdi>
            </td>
            <td className="num" dir="ltr">
              {money(line.amount)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={2}>Total · المجموع</td>
          <td className="num" dir="ltr">
            {money(total(lines))}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

/** Bilingual avenant: the new schedule of the unpaid part of a sale (CLAUDE.md §7). */
export function ScheduleAmendmentTemplate({
  data,
  company,
}: {
  data: ScheduleAmendmentData;
  company: CompanyIdentity;
}) {
  const money = (v: Centimes) => formatDZD(v, "fr");
  const contract = data.saleDeedNumber
    ? `contrat de vente sur plans ${data.saleDeedNumber} (réservation ${data.saleNumber})`
    : `contrat de réservation ${data.saleNumber} du ${formatDate(data.reservedOn)}`;
  const rescheduled = total(data.lines);
  return (
    <PdfDocument title={`Avenant ${data.sequence} · ${data.saleNumber}`} css={CSS}>
      <Letterhead company={company} />

      <div className="title">
        <h1>AVENANT N° {data.sequence}</h1>
        <div className="muted">Le {formatDate(data.signedOn)}</div>
        <h1 dir="rtl" lang="ar">
          ملحق رقم {data.sequence}
        </h1>
      </div>

      <div className="box">
        <p>
          <b>Objet :</b> modification de l&apos;échéancier de paiement · {data.projectName} · lot{" "}
          <b dir="ltr">{data.unitCode}</b> · {contract}
        </p>
        <p dir="rtl" lang="ar">
          <b>الموضوع:</b> تعديل جدول الدفعات · <bdi>{data.projectName}</bdi> · الوحدة{" "}
          <bdi>{data.unitCode}</bdi> · الحجز <bdi>{data.saleNumber}</bdi>
        </p>
      </div>

      <p>
        Entre le promoteur et{" "}
        {data.buyers.map((b, i) => (
          <span key={b.name}>
            {i > 0 ? ", " : ""}
            <b>{b.name}</b>
            {b.nin ? ` (NIN ${b.nin})` : ""}
          </span>
        ))}
        , il est convenu de remplacer les échéances restant dues du contrat par l&apos;échéancier
        ci-dessous. Le prix de vente de <b dir="ltr">{money(data.price)}</b> est inchangé ; les
        versements déjà effectués, soit <b dir="ltr">{money(data.paid)}</b>, restent acquis. Toutes
        les autres clauses du contrat demeurent applicables.
      </p>
      <p dir="rtl" lang="ar">
        اتفق المرقي و
        {data.buyers.map((b, i) => (
          <span key={b.name}>
            {i > 0 ? "، " : " "}
            <b>
              <bdi>{b.nameAr ?? b.name}</bdi>
            </b>
          </span>
        ))}{" "}
        على تعويض الدفعات المتبقية من العقد بالجدول أدناه. يبقى سعر البيع{" "}
        <b>
          <bdi dir="ltr">{money(data.price)}</bdi>
        </b>{" "}
        دون تغيير، وتبقى الدفعات المسددة، أي{" "}
        <b>
          <bdi dir="ltr">{money(data.paid)}</bdi>
        </b>
        ، مكتسبة. وتبقى جميع البنود الأخرى للعقد سارية.
      </p>
      <p>
        <b>Motif · السبب :</b> <bdi>{data.reason}</bdi>
      </p>

      <h2>Échéances remplacées · الدفعات المعوَّضة</h2>
      <Lines lines={data.replaced} className="old" />

      <h2>Nouvel échéancier · الجدول الجديد</h2>
      <Lines lines={data.lines} />
      <p>Soit : {amountInWordsFr(rescheduled)}.</p>
      <p dir="rtl" lang="ar">
        أي: {amountInWordsAr(rescheduled)}.
      </p>

      <div className="signatures">
        <div className="muted">Le promoteur · المرقي</div>
        <div className="muted">L&apos;acquéreur · المكتتب</div>
      </div>
    </PdfDocument>
  );
}
