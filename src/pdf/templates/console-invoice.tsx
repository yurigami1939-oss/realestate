import "server-only";

import type { InvoiceParty } from "@/lib/billing";
import { formatDate } from "@/lib/dates";
import { amountInWordsAr, amountInWordsFr, type Centimes, formatDZD } from "@/lib/money";
import { formatPercentInput } from "@/lib/money";

import { PdfDocument } from "../document";

/** Everything printed on an operator invoice or credit note, already resolved. */
export type ConsoleDocumentData = {
  kind: "invoice" | "credit_note";
  number: string;
  issuedOn: string;
  /** Invoices: the day to pay by. */
  dueOn: string | null;
  seller: InvoiceParty;
  /** Data URI of the operator's logo, when there is one. */
  sellerLogo: string | null;
  buyer: InvoiceParty;
  lines: {
    labelFr: string;
    labelAr: string;
    quantity: number;
    unitPrice: Centimes;
    amount: Centimes;
  }[];
  /** Null: no VAT (the operator's regime). */
  vatRateBp: number | null;
  totals: { ht: Centimes; vat: Centimes; ttc: Centimes };
  /** Credit notes: the invoice corrected and why. */
  invoiceNumber?: string;
  reason?: string;
};

const CSS = `
@page{size:A4;margin:16mm}
header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12pt}
.org{font-size:13pt;font-weight:700}
.title{display:flex;justify-content:space-between;align-items:center;border-block:1pt solid #171717;padding:6pt 0;margin-bottom:12pt}
.title h1{font-size:15pt;margin:0}
.parties{display:flex;gap:12pt;margin-bottom:10pt}
.box{flex:1;border:1pt solid #d4d4d4;border-radius:4pt;padding:8pt}
.box h2{font-size:8.5pt;color:#525252;font-weight:600;margin:0 0 4pt}
b{font-weight:600}
p{margin:0 0 4pt}
table{width:100%;border-collapse:collapse;margin:8pt 0}
th,td{border-bottom:0.75pt solid #d4d4d4;padding:4pt 6pt;text-align:start;vertical-align:top}
th{font-size:8.5pt;color:#525252;font-weight:600}
td.num,th.num{text-align:end;white-space:nowrap}
.totals{width:55%;margin-inline-start:auto}
.totals td{border-bottom:none}
.ttc td{font-weight:700;border-top:1pt solid #171717}
.words{margin-top:8pt}
.footer{margin-top:14pt;border-top:0.75pt solid #d4d4d4;padding-top:6pt;font-size:8pt;color:#525252;white-space:pre-line}
`;

function identifiers(party: InvoiceParty): string {
  return [
    party.rcNumber ? `RC ${party.rcNumber}` : "",
    party.nif ? `NIF ${party.nif}` : "",
    party.nis ? `NIS ${party.nis}` : "",
    party.aiNumber ? `AI ${party.aiNumber}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function Party({ party }: { party: InvoiceParty }) {
  return (
    <>
      <p>
        <b>
          <bdi>{party.legalName}</bdi>
        </b>
      </p>
      {party.address || party.wilaya ? (
        <p>
          <bdi>{[party.address, party.wilaya].filter(Boolean).join(", ")}</bdi>
        </p>
      ) : null}
      {identifiers(party) ? <p className="muted">{identifiers(party)}</p> : null}
    </>
  );
}

/**
 * Bilingual operator invoice (FACTURE · فاتورة) or credit note (AVOIR · إشعار دائن), CLAUDE.console.md
 * §11: the operator's letterhead from its snapshot, the client, the lines, HT / VAT / TTC (or the
 * no-VAT mention), the amount in words in French and Arabic, the due day and the RIB.
 */
export function ConsoleInvoiceTemplate({ data }: { data: ConsoleDocumentData }) {
  const money = (v: Centimes) => formatDZD(v, "fr");
  const seller = data.seller;
  const credit = data.kind === "credit_note";
  return (
    <PdfDocument title={data.number} css={CSS}>
      <header>
        <div style={{ display: "flex", alignItems: "center", gap: "10pt" }}>
          {data.sellerLogo ? (
            // Static HTML printed by Chromium (not a Next page): a plain image, embedded as data.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.sellerLogo}
              alt=""
              style={{ maxHeight: "46pt", maxWidth: "130pt", objectFit: "contain" }}
            />
          ) : null}
          <div>
            <div className="org">
              {seller.brand ? `${seller.brand} · ` : ""}
              {seller.legalName}
              {seller.legalForm ? ` (${seller.legalForm})` : ""}
            </div>
            <div className="muted">
              {[seller.address, seller.wilaya].filter(Boolean).join(", ")}
            </div>
            {seller.phone || seller.email ? (
              <div className="muted">
                {[seller.phone, seller.email].filter(Boolean).join(" · ")}
              </div>
            ) : null}
          </div>
        </div>
        <div className="muted" style={{ textAlign: "end" }}>
          {identifiers(seller)}
        </div>
      </header>

      <div className="title">
        <h1>{credit ? "AVOIR" : "FACTURE"}</h1>
        <b dir="ltr">N° {data.number}</b>
        <h1 dir="rtl" lang="ar">
          {credit ? "إشعار دائن" : "فاتورة"}
        </h1>
      </div>

      <div className="parties">
        <div className="box">
          <h2>
            Client · <span lang="ar">الزبون</span>
          </h2>
          <Party party={data.buyer} />
        </div>
        <div className="box">
          <p>
            <b>
              Date · <bdi lang="ar">التاريخ</bdi> :
            </b>{" "}
            {formatDate(data.issuedOn)}
          </p>
          {data.dueOn ? (
            <p>
              <b>
                Échéance · <bdi lang="ar">تاريخ الاستحقاق</bdi> :
              </b>{" "}
              {formatDate(data.dueOn)}
            </p>
          ) : null}
          {data.invoiceNumber ? (
            <p>
              <b>
                Facture · <bdi lang="ar">الفاتورة</bdi> :
              </b>{" "}
              <bdi dir="ltr">{data.invoiceNumber}</bdi>
            </p>
          ) : null}
          {data.reason ? (
            <p>
              <b>
                Motif · <bdi lang="ar">السبب</bdi> :
              </b>{" "}
              <bdi>{data.reason}</bdi>
            </p>
          ) : null}
        </div>
      </div>

      {data.lines.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>
                Désignation · <span lang="ar">البيان</span>
              </th>
              <th className="num">
                Qté · <span lang="ar">الكمية</span>
              </th>
              <th className="num">
                P.U. HT · <span lang="ar">سعر الوحدة</span>
              </th>
              <th className="num">
                Montant HT · <span lang="ar">المبلغ</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line, index) => (
              <tr key={`${index}-${line.labelFr}`}>
                <td>
                  <div>
                    <bdi>{line.labelFr}</bdi>
                  </div>
                  <div className="muted" dir="rtl" lang="ar">
                    <bdi>{line.labelAr}</bdi>
                  </div>
                </td>
                <td className="num" dir="ltr">
                  {line.quantity}
                </td>
                <td className="num" dir="ltr">
                  {money(line.unitPrice)}
                </td>
                <td className="num" dir="ltr">
                  {money(line.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <table className="totals">
        <tbody>
          <tr>
            <td>
              Total HT · <bdi lang="ar">المجموع دون الرسم</bdi>
            </td>
            <td className="num" dir="ltr">
              {money(data.totals.ht)}
            </td>
          </tr>
          {data.vatRateBp === null ? (
            <tr>
              <td colSpan={2} className="muted">
                TVA non applicable · <bdi lang="ar">غير خاضع للرسم على القيمة المضافة</bdi>
              </td>
            </tr>
          ) : (
            <tr>
              <td>
                <bdi>TVA {formatPercentInput(data.vatRateBp)} %</bdi> ·{" "}
                <bdi lang="ar">الرسم على القيمة المضافة</bdi>
              </td>
              <td className="num" dir="ltr">
                {money(data.totals.vat)}
              </td>
            </tr>
          )}
          <tr className="ttc">
            <td>
              Total TTC · <bdi lang="ar">المجموع مع الرسم</bdi>
            </td>
            <td className="num" dir="ltr">
              {money(data.totals.ttc)}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="words">
        <p>
          {credit ? "Arrêté le présent avoir" : "Arrêtée la présente facture"} à la somme de :{" "}
          {amountInWordsFr(data.totals.ttc)}.
        </p>
        <p dir="rtl" lang="ar">
          {credit ? "أوقف هذا الإشعار" : "أوقفت هذه الفاتورة"} على مبلغ:{" "}
          {amountInWordsAr(data.totals.ttc)}.
        </p>
      </div>

      {!credit && seller.rib ? (
        <p>
          <b>
            Règlement par virement · <bdi lang="ar">الدفع بالتحويل</bdi> :
          </b>{" "}
          {seller.bank ? <bdi>{seller.bank}</bdi> : null} · RIB <bdi dir="ltr">{seller.rib}</bdi>
          {data.dueOn ? ` · avant le ${formatDate(data.dueOn)}` : ""}
        </p>
      ) : null}

      {seller.footerFr || seller.footerAr ? (
        <div className="footer">
          {seller.footerFr ? <p>{seller.footerFr}</p> : null}
          {seller.footerAr ? (
            <p dir="rtl" lang="ar">
              {seller.footerAr}
            </p>
          ) : null}
        </div>
      ) : null}
    </PdfDocument>
  );
}
