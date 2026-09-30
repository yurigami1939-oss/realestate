import "server-only";

import { formatDate } from "@/lib/dates";
import { amountInWordsAr, amountInWordsFr, formatDZD } from "@/lib/money";
import { formatShare } from "@/lib/payment-plans";
import { formatPhone } from "@/lib/phone";
import type { QuotationDocument } from "@/server/quotations/queries";

import { PdfDocument } from "../document";

const CSS = `
@page{size:A4;margin:14mm}
header{display:flex;justify-content:space-between;gap:16pt;margin-bottom:12pt}
.org{font-size:13pt;font-weight:700}
.title{display:flex;justify-content:space-between;align-items:center;border-block:1pt solid #171717;padding:6pt 0;margin-bottom:10pt}
.title h1{font-size:15pt;margin:0}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:10pt;margin-bottom:10pt}
.box{border:1pt solid #d4d4d4;border-radius:4pt;padding:7pt}
.box h2{font-size:10pt;margin:0 0 4pt;display:flex;justify-content:space-between}
.kv{display:flex;justify-content:space-between;gap:8pt}
.label{color:#525252}
b{font-weight:600}
table{width:100%;border-collapse:collapse;margin:8pt 0}
th,td{border-bottom:0.75pt solid #d4d4d4;padding:4pt 5pt;text-align:start;vertical-align:top}
th{font-size:8.5pt;color:#525252;font-weight:600}
td.num,th.num{text-align:end;white-space:nowrap}
tfoot td{font-weight:700;border-bottom:none}
.net{font-size:14pt;font-weight:700}
.words{margin-top:4pt}
.notice{margin-top:12pt;border-top:1pt solid #a3a3a3;padding-top:6pt}
`;

type Doc = QuotationDocument;

function floorLabel(floor: number): { fr: string; ar: string } {
  if (floor === 0) return { fr: "RDC", ar: "الطابق الأرضي" };
  if (floor < 0) return { fr: `Sous-sol ${-floor}`, ar: `الطابق تحت الأرضي ${-floor}` };
  return { fr: `Étage ${floor}`, ar: `الطابق ${floor}` };
}

/** French due text, plus an Arabic line when there is something to translate. */
function dueLabel(line: Doc["lines"][number]): { fr: string; ar: string | null } {
  if (line.trigger === "signing") return { fr: "À la signature", ar: "عند التوقيع" };
  const date = line.dueOn ? formatDate(line.dueOn) : null;
  if (line.trigger === "months_after_signing") return { fr: date ?? "—", ar: null };
  // Milestone names are typed by the promoter (usually French): only the date is translated.
  const name = line.milestoneName ?? "—";
  return date
    ? { fr: `${name} (prévu le ${date})`, ar: `متوقع في ${date}` }
    : { fr: name, ar: null };
}

const area = (value: string | null) => (value ? `${value.replace(".", ",")} m²` : "—");

/** Bilingual quotation (FR + AR on one page, CLAUDE.md §12). Indicative, not a contract. */
export function QuotationTemplate({ doc }: { doc: Doc }) {
  const c = doc.company;
  const money = (v: bigint) => formatDZD(v, "fr");
  const floor = floorLabel(doc.unitFloor);
  const location = [doc.projectAddress, doc.projectCommune, doc.projectWilaya]
    .filter(Boolean)
    .join(", ");

  return (
    <PdfDocument title={doc.number} css={CSS}>
      <header>
        <div>
          <div className="org">{c.legalName ?? c.name}</div>
          <div className="muted">{[c.address, c.wilaya].filter(Boolean).join(", ")}</div>
          {c.phone ? <div className="muted">Tél. {c.phone}</div> : null}
        </div>
        <div className="muted" style={{ textAlign: "end" }}>
          {c.rcNumber ? `RC ${c.rcNumber}` : ""} {c.nif ? `· NIF ${c.nif}` : ""}
          <br />
          {c.nis ? `NIS ${c.nis}` : ""} {c.aiNumber ? `· AI ${c.aiNumber}` : ""}
        </div>
      </header>

      <div className="title">
        <h1>DEVIS</h1>
        <div style={{ textAlign: "center" }}>
          <b>N° {doc.number}</b>
          <div className="muted">
            {formatDate(doc.issuedAt)} · Valable jusqu’au {formatDate(doc.validUntil)}
          </div>
          <div className="muted" dir="rtl" lang="ar">
            صالح إلى غاية {formatDate(doc.validUntil)}
          </div>
        </div>
        <h1 dir="rtl" lang="ar">
          عرض سعر
        </h1>
      </div>

      <div className="cols">
        <div className="box">
          <h2>
            <span>Client</span>
            <span dir="rtl" lang="ar">
              الزبون
            </span>
          </h2>
          <div>
            <b>
              <bdi>{doc.leadName}</bdi>
            </b>
          </div>
          <div className="muted" dir="ltr">
            {formatPhone(doc.leadPhone)}
          </div>
        </div>
        <div className="box">
          <h2>
            <span>Bien proposé</span>
            <span dir="rtl" lang="ar">
              العقار المقترح
            </span>
          </h2>
          <div>
            <b>{doc.projectName}</b>
            {location ? <span className="muted"> · {location}</span> : null}
          </div>
          <div className="kv">
            <span>
              {doc.buildingName} · Lot <b dir="ltr">{doc.unitCode}</b> · {floor.fr}
            </span>
            <span dir="rtl" lang="ar">
              {floor.ar}
            </span>
          </div>
          <div className="kv">
            <span>
              {doc.unitTypology ?? ""} · Surface habitable {area(doc.unitLivingArea)}
            </span>
            <span dir="rtl" lang="ar">
              المساحة الصالحة للسكن <bdi>{area(doc.unitLivingArea)}</bdi>
            </span>
          </div>
        </div>
      </div>

      <div className="box">
        <div className="kv">
          <span>Prix de vente · سعر البيع</span>
          <b dir="ltr">{money(doc.listPrice)}</b>
        </div>
        {doc.discount > 0n ? (
          <div className="kv">
            <span>Remise · تخفيض</span>
            <b dir="ltr">− {money(doc.discount)}</b>
          </div>
        ) : null}
        <div className="kv net">
          <span>Prix net · السعر الصافي</span>
          <span dir="ltr">{money(doc.price)}</span>
        </div>
        <p className="words">Soit : {amountInWordsFr(doc.price)}.</p>
        <p dir="rtl" lang="ar">
          أي: {amountInWordsAr(doc.price)}.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>
              Échéance · <span lang="ar">الدفعة</span>
            </th>
            <th>
              Exigibilité · <span lang="ar">الاستحقاق</span>
            </th>
            <th className="num">%</th>
            <th className="num">
              Montant · <span lang="ar">المبلغ</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((line) => {
            const due = dueLabel(line);
            return (
              <tr key={line.position}>
                <td>{line.position}</td>
                <td>
                  <bdi>{line.label}</bdi>
                </td>
                <td>
                  <div>{due.fr}</div>
                  {due.ar ? (
                    <div className="muted" dir="rtl" lang="ar">
                      {due.ar}
                    </div>
                  ) : null}
                </td>
                <td className="num" dir="ltr">
                  {formatShare(line.shareBp)}
                </td>
                <td className="num" dir="ltr">
                  {money(line.amount)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Total · المجموع</td>
            <td className="num">100 %</td>
            <td className="num" dir="ltr">
              {money(doc.price)}
            </td>
          </tr>
        </tfoot>
      </table>

      {doc.notes ? <p className="muted">{doc.notes}</p> : null}

      <div className="notice muted">
        <p>
          Document indicatif, non contractuel. Prix et disponibilité du lot garantis jusqu’au{" "}
          {formatDate(doc.validUntil)} ; les dates liées aux travaux sont prévisionnelles. Établi
          par {doc.issuerName}.
        </p>
        <p dir="rtl" lang="ar">
          وثيقة إرشادية غير تعاقدية. السعر وتوفر الوحدة مضمونان إلى غاية{" "}
          {formatDate(doc.validUntil)}، والتواريخ المرتبطة بالأشغال تقديرية. أعدّه{" "}
          <bdi>{doc.issuerName}</bdi>.
        </p>
      </div>
    </PdfDocument>
  );
}
