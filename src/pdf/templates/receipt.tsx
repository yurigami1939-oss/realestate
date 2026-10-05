import "server-only";

import { formatDate } from "@/lib/dates";
import { amountInWordsAr, amountInWordsFr, type Centimes, formatDZD } from "@/lib/money";

import { PdfDocument } from "../document";

/** Everything printed on a payment receipt, already resolved (no lookups in templates). */
export type ReceiptData = {
  number: string;
  issuedAt: Date;
  organization: {
    legalName: string;
    address: string;
    rcNumber: string;
    nif: string;
    nis: string;
    aiNumber: string;
    /** Data URI of the company logo, when there is one. */
    logo?: string | null;
  };
  payer: { fr: string; ar: string };
  reference: { fr: string; ar: string };
  method: { fr: string; ar: string };
  amount: Centimes;
  cashier: string;
  /** Paid online by card (SATIM): no cashier signs. */
  online?: boolean;
  /** Document title (default: payment receipt) and who signs opposite the cashier (client). */
  title?: { fr: string; ar: string };
  party?: { fr: string; ar: string };
};

const CSS = `
@page{size:A5 landscape;margin:12mm}
header{display:flex;justify-content:space-between;margin-bottom:12pt}
.org{font-size:13pt;font-weight:700}
.title{display:flex;justify-content:space-between;align-items:center;border-block:1pt solid #171717;padding:6pt 0;margin-bottom:10pt}
.title h1{font-size:15pt;margin:0}
.grid{display:grid;grid-template-columns:1fr 1fr;column-gap:16pt;row-gap:5pt}
.label{color:#525252}
b{font-weight:600}
.amount{border:1pt solid #d4d4d4;border-radius:4pt;padding:8pt;margin:10pt 0;text-align:center;font-size:18pt;font-weight:700}
.signatures{display:flex;justify-content:space-between;margin-top:26pt}
.signatures div{width:45%;border-top:1pt solid #a3a3a3;padding-top:4pt}
.code{white-space:nowrap}
`;

/** Document numbers and unit codes (BAL-2026-000001, A-03-12, VIR-118). */
const CODE = /([A-Z][A-Z0-9]{0,3}(?:-[A-Z0-9]+)+)/;

/** Text whose codes never wrap at their hyphens and keep their left-to-right order. */
function WithCodes({ text }: { text: string }) {
  return text.split(CODE).map((part, index) =>
    index % 2 === 1 ? (
      <bdi key={index} dir="ltr" className="code">
        {part}
      </bdi>
    ) : (
      part
    ),
  );
}

function Row({ fr, ar, value }: { fr: string; ar: string; value: { fr: string; ar: string } }) {
  return (
    <>
      <div>
        <span className="label">{fr} : </span>
        <b>
          <WithCodes text={value.fr} />
        </b>
      </div>
      <div dir="rtl" lang="ar">
        <span className="label">{ar}: </span>
        <b>
          <bdi>
            <WithCodes text={value.ar} />
          </bdi>
        </b>
      </div>
    </>
  );
}

/** Bilingual receipt: French on the start side, Arabic on the other, amount in words in both. */
export function ReceiptTemplate({ data }: { data: ReceiptData }) {
  const org = data.organization;
  const date = formatDate(data.issuedAt);
  return (
    <PdfDocument title={data.number} css={CSS}>
      <header>
        <div style={{ display: "flex", alignItems: "center", gap: "10pt" }}>
          {org.logo ? (
            // Static HTML printed by Chromium (not a Next page): a plain image, embedded as data.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={org.logo}
              alt=""
              style={{ maxHeight: "40pt", maxWidth: "120pt", objectFit: "contain" }}
            />
          ) : null}
          <div>
            <div className="org">{org.legalName}</div>
            <div className="muted">{org.address}</div>
          </div>
        </div>
        <div className="muted" style={{ textAlign: "end" }}>
          RC {org.rcNumber} · NIF {org.nif}
          <br />
          NIS {org.nis} · AI {org.aiNumber}
        </div>
      </header>

      <div className="title">
        <h1>{data.title?.fr ?? "REÇU DE PAIEMENT"}</h1>
        <b>N° {data.number}</b>
        <h1 dir="rtl" lang="ar">
          {data.title?.ar ?? "وصل دفع"}
        </h1>
      </div>

      <div className="grid">
        <Row fr="Date" ar="التاريخ" value={{ fr: date, ar: date }} />
        <Row fr="Reçu de" ar="استلمنا من" value={data.payer} />
        <Row fr="Objet" ar="الموضوع" value={data.reference} />
        <Row fr="Mode de paiement" ar="طريقة الدفع" value={data.method} />
      </div>

      <div className="amount">{formatDZD(data.amount, "fr")}</div>
      <p>Arrêté le présent reçu à la somme de : {amountInWordsFr(data.amount)}.</p>
      <p dir="rtl" lang="ar">
        أوقف هذا الوصل على مبلغ: {amountInWordsAr(data.amount)}.
      </p>

      <div className="signatures">
        {data.online ? (
          <div className="muted">
            Paiement en ligne · دفع إلكتروني
            <br />
            <span style={{ color: "#171717" }}>SATIM · CIB / Edahabia</span>
          </div>
        ) : (
          <div className="muted">
            Le caissier · أمين الصندوق
            <br />
            <span style={{ color: "#171717" }}>{data.cashier}</span>
          </div>
        )}
        <div className="muted">
          {data.party?.fr ?? "Le client"} · {data.party?.ar ?? "الزبون"}
        </div>
      </div>
    </PdfDocument>
  );
}
