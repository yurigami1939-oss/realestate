import "server-only";

import { formatDate } from "@/lib/dates";
import { amountInWordsAr, amountInWordsFr, formatDZD } from "@/lib/money";
import { formatShare } from "@/lib/payment-plans";
import { formatPhone } from "@/lib/phone";
import type { CompanyProfile } from "@/server/organizations/settings";
import type { SaleDetail } from "@/server/sales/sale-queries";

import { PdfDocument } from "../document";

const CSS = `
@page{size:A4;margin:14mm}
header{display:flex;justify-content:space-between;gap:16pt;margin-bottom:10pt}
.org{font-size:13pt;font-weight:700}
.title{display:flex;justify-content:space-between;align-items:center;border-block:1pt solid #171717;padding:6pt 0;margin-bottom:10pt}
.title h1{font-size:15pt;margin:0}
.box{border:1pt solid #d4d4d4;border-radius:4pt;padding:7pt;margin-bottom:8pt}
.box h2{font-size:10pt;margin:0 0 4pt;display:flex;justify-content:space-between}
.kv{display:flex;justify-content:space-between;gap:8pt}
.buyers{display:grid;grid-template-columns:1fr 1fr;gap:8pt}
b{font-weight:600}
table{width:100%;border-collapse:collapse;margin:6pt 0}
th,td{border-bottom:0.75pt solid #d4d4d4;padding:3.5pt 5pt;text-align:start;vertical-align:top}
th{font-size:8.5pt;color:#525252;font-weight:600}
td.num,th.num{text-align:end;white-space:nowrap}
tfoot td{font-weight:700;border-bottom:none}
.net{font-size:13pt;font-weight:700}
.signatures{display:flex;justify-content:space-between;margin-top:22pt}
.signatures div{width:45%;border-top:1pt solid #a3a3a3;padding-top:4pt}
`;

type Sale = SaleDetail;

function dueLabel(line: Sale["installments"][number]): { fr: string; ar: string | null } {
  if (line.trigger === "signing") return { fr: "À la signature", ar: "عند التوقيع" };
  if (line.trigger === "months_after_signing") {
    const date = line.dueOn ? formatDate(line.dueOn) : "—";
    return { fr: date, ar: null };
  }
  const name = line.milestoneName ?? "—";
  if (line.dueOn)
    return {
      fr: `${name} (exigible le ${formatDate(line.dueOn)})`,
      ar: `مستحقة في ${formatDate(line.dueOn)}`,
    };
  return {
    fr: `À l'achèvement : ${name}`,
    ar: "عند إنجاز المرحلة",
  };
}

/** Internal bilingual reservation sheet for the notary (CLAUDE.md §12) — not the legal contract. */
export function ReservationSheetTemplate({
  sale,
  company,
}: {
  sale: Sale;
  company: CompanyProfile;
}) {
  const money = (v: bigint) => formatDZD(v, "fr");
  const location = [sale.projectAddress, sale.projectCommune, sale.projectWilaya]
    .filter(Boolean)
    .join(", ");
  return (
    <PdfDocument title={sale.number} css={CSS}>
      <header>
        <div>
          <div className="org">{company.legalName ?? company.name}</div>
          <div className="muted">
            {[company.address, company.wilaya].filter(Boolean).join(", ")}
          </div>
          {company.phone ? <div className="muted">Tél. {company.phone}</div> : null}
        </div>
        <div className="muted" style={{ textAlign: "end" }}>
          {company.rcNumber ? `RC ${company.rcNumber}` : ""}{" "}
          {company.nif ? `· NIF ${company.nif}` : ""}
          <br />
          {company.nis ? `NIS ${company.nis}` : ""}{" "}
          {company.aiNumber ? `· AI ${company.aiNumber}` : ""}
        </div>
      </header>

      <div className="title">
        <h1>FICHE DE RÉSERVATION</h1>
        <div style={{ textAlign: "center" }}>
          <b>N° {sale.number}</b>
          <div className="muted">Réservation du {formatDate(sale.reservedOn)}</div>
        </div>
        <h1 dir="rtl" lang="ar">
          بطاقة حجز
        </h1>
      </div>

      <div className="box">
        <h2>
          <span>{sale.buyers.length > 1 ? "Acquéreurs" : "Acquéreur"}</span>
          <span dir="rtl" lang="ar">
            {sale.buyers.length > 1 ? "المشترون" : "المشتري"}
          </span>
        </h2>
        <div className="buyers">
          {sale.buyers.map((b) => (
            <div key={b.id}>
              <div>
                <b>
                  {b.lastName} {b.firstName}
                </b>
                {b.lastNameAr || b.firstNameAr ? (
                  <>
                    {" · "}
                    <bdi dir="rtl" lang="ar">
                      {[b.lastNameAr, b.firstNameAr].filter(Boolean).join(" ")}
                    </bdi>
                  </>
                ) : null}
              </div>
              {b.birthDate ? (
                <div className="muted">
                  Né(e) le {formatDate(b.birthDate)}
                  {b.birthPlace ? ` à ${b.birthPlace}` : ""}
                </div>
              ) : null}
              {b.nin ? <div className="muted">NIN {b.nin}</div> : null}
              <div className="muted">
                {[
                  [b.address, b.commune, b.wilaya].filter(Boolean).join(", "),
                  b.phone ? formatPhone(b.phone) : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="box">
        <h2>
          <span>Bien réservé</span>
          <span dir="rtl" lang="ar">
            العقار المحجوز
          </span>
        </h2>
        <div>
          <b>{sale.projectName}</b>
          {location ? <span className="muted"> · {location}</span> : null}
        </div>
        <div>
          {sale.buildingName} · Lot <b dir="ltr">{sale.unitCode}</b>
          {sale.unitTypology ? ` · ${sale.unitTypology}` : ""}
          {sale.unitLivingArea ? ` · ${sale.unitLivingArea.replace(".", ",")} m²` : ""}
        </div>
      </div>

      <div className="box">
        <div className="kv">
          <span>Prix de vente · سعر البيع</span>
          <b dir="ltr">{money(sale.listPrice)}</b>
        </div>
        {sale.discount > 0n ? (
          <div className="kv">
            <span>Remise · تخفيض</span>
            <b dir="ltr">− {money(sale.discount)}</b>
          </div>
        ) : null}
        <div className="kv net">
          <span>Prix convenu · السعر المتفق عليه</span>
          <span dir="ltr">{money(sale.price)}</span>
        </div>
        <p>Soit : {amountInWordsFr(sale.price)}.</p>
        <p dir="rtl" lang="ar">
          أي: {amountInWordsAr(sale.price)}.
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
          {sale.installments.map((line) => {
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
              {money(sale.price)}
            </td>
          </tr>
        </tfoot>
      </table>

      {sale.reservationNotary ? (
        <p className="muted">
          Notaire : {sale.reservationNotary}
          {sale.reservationReference ? ` · Réf. ${sale.reservationReference}` : ""}
        </p>
      ) : null}
      {sale.notes ? <p className="muted">{sale.notes}</p> : null}
      <p className="muted">
        Fiche interne transmise au notaire ; elle ne remplace pas le contrat de réservation.
        Commercial : {sale.commercialName ?? "—"}.
      </p>
      <p className="muted" dir="rtl" lang="ar">
        بطاقة داخلية تُرسل إلى الموثق؛ ولا تحل محل عقد الحجز.
      </p>

      <div className="signatures">
        <div className="muted">Le promoteur · المرقي</div>
        <div className="muted">L&apos;acquéreur · المشتري</div>
      </div>
    </PdfDocument>
  );
}
