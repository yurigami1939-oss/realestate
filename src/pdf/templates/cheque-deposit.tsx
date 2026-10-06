import "server-only";

import { formatDate } from "@/lib/dates";
import { amountInWordsAr, amountInWordsFr, type Centimes, formatDZD } from "@/lib/money";
import type { CompanyIdentity } from "@/server/organizations/settings";

import { PdfDocument } from "../document";

import { Letterhead } from "./letterhead";

/** Everything printed on a cheque deposit slip, already resolved (no lookups in templates). */
export type ChequeDepositData = {
  number: string;
  depositedOn: string;
  accountName: string;
  bankName: string | null;
  accountNumber: string | null;
  total: Centimes;
  cheques: {
    chequeNumber: string | null;
    bank: string | null;
    payerName: string;
    receivedOn: string;
    amount: Centimes;
  }[];
};

const CSS = `
@page{size:A4;margin:16mm}
.title{display:flex;justify-content:space-between;align-items:center;border-block:1pt solid #171717;padding:6pt 0;margin-bottom:12pt}
.title h1{font-size:15pt;margin:0}
.box{border:1pt solid #d4d4d4;border-radius:4pt;padding:8pt;margin-bottom:10pt}
b{font-weight:600}
p{margin:0 0 6pt}
table{width:100%;border-collapse:collapse;margin:8pt 0}
th,td{border-bottom:0.75pt solid #d4d4d4;padding:4pt 6pt;text-align:start}
th{font-size:8.5pt;color:#525252;font-weight:600}
td.num,th.num{text-align:end;white-space:nowrap}
tfoot td{font-weight:700;border-bottom:none}
.signatures{display:flex;justify-content:space-between;margin-top:28pt}
.signatures div{width:45%;border-top:1pt solid #a3a3a3;padding-top:4pt}
`;

/** Bilingual bordereau de remise de chèques handed to the bank (CLAUDE.md §7 Treasury). */
export function ChequeDepositTemplate({
  data,
  company,
}: {
  data: ChequeDepositData;
  company: CompanyIdentity;
}) {
  const money = (v: Centimes) => formatDZD(v, "fr");
  return (
    <PdfDocument title={data.number} css={CSS}>
      <Letterhead company={company} />

      <div className="title">
        <h1>BORDEREAU DE REMISE DE CHÈQUES</h1>
        <div className="muted" dir="ltr">
          {data.number}
        </div>
        <h1 dir="rtl" lang="ar">
          جدول إيداع الصكوك
        </h1>
      </div>

      <div className="box">
        <p>
          <b>Compte à créditer · الحساب المراد قيده:</b> <bdi>{data.accountName}</bdi>
          {data.bankName ? (
            <>
              {" · "}
              <bdi>{data.bankName}</bdi>
            </>
          ) : null}
        </p>
        {data.accountNumber ? (
          <p>
            <b>RIB / RIP:</b> <bdi dir="ltr">{data.accountNumber}</bdi>
          </p>
        ) : null}
        <p>
          <b>Date de remise · تاريخ الإيداع:</b> {formatDate(data.depositedOn)}
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>
              N° de chèque · <span lang="ar">رقم الصك</span>
            </th>
            <th>
              Banque · <span lang="ar">البنك</span>
            </th>
            <th>
              Tireur · <span lang="ar">الساحب</span>
            </th>
            <th>
              Reçu le · <span lang="ar">تاريخ الاستلام</span>
            </th>
            <th className="num">
              Montant · <span lang="ar">المبلغ</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.cheques.map((c, index) => (
            <tr key={`${index}-${c.chequeNumber ?? ""}`}>
              <td>{index + 1}</td>
              <td dir="ltr">{c.chequeNumber ?? "—"}</td>
              <td>
                <bdi>{c.bank ?? "—"}</bdi>
              </td>
              <td>
                <bdi>{c.payerName}</bdi>
              </td>
              <td dir="ltr">{formatDate(c.receivedOn)}</td>
              <td className="num" dir="ltr">
                {money(c.amount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>Total · المجموع ({data.cheques.length})</td>
            <td className="num" dir="ltr">
              {money(data.total)}
            </td>
          </tr>
        </tfoot>
      </table>

      <p>Soit : {amountInWordsFr(data.total)}.</p>
      <p dir="rtl" lang="ar">
        أي: {amountInWordsAr(data.total)}.
      </p>

      <div className="signatures">
        <div className="muted">Le remettant · المودِع</div>
        <div className="muted">La banque (cachet) · البنك (الختم)</div>
      </div>
    </PdfDocument>
  );
}
