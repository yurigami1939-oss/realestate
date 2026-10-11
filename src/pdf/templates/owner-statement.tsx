import "server-only";

import { formatDate } from "@/lib/dates";
import { amountInWordsAr, amountInWordsFr, type Centimes, formatDZD } from "@/lib/money";
import type { CompanyIdentity } from "@/server/organizations/settings";

import { PdfDocument } from "../document";

import { Letterhead } from "./letterhead";

/** Everything printed on an owner statement, already resolved (no lookups in templates). */
export type OwnerStatementData = {
  number: string;
  issuedOn: string;
  periodFrom: string | null;
  periodTo: string;
  owner: { name: string; nameAr: string | null; address: string | null; rib: string | null };
  lines: {
    leaseNumber: string;
    tenantName: string;
    unitCode: string;
    receiptNumber: string;
    paidOn: string;
    amount: Centimes;
    feeRateBp: number;
    fee: Centimes;
    reversal: boolean;
  }[];
  extras: { label: string; amount: Centimes }[];
  collected: Centimes;
  fees: Centimes;
  deductions: Centimes;
  net: Centimes;
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
.totals td{border-bottom:none}
.net td{font-weight:700;border-top:1pt solid #171717}
.reversal td{color:#991b1b}
`;

/**
 * Bilingual relevé de gérance (CLAUDE.md §7 Rentals): the rents collected for the owner over
 * the period, the management fees, the other deductions and the net paid out.
 */
export function OwnerStatementTemplate({
  data,
  company,
}: {
  data: OwnerStatementData;
  company: CompanyIdentity;
}) {
  const money = (v: Centimes) => formatDZD(v, "fr");
  return (
    <PdfDocument title={data.number} css={CSS}>
      <Letterhead company={company} />

      <div className="title">
        <h1>RELEVÉ DE GÉRANCE</h1>
        <div className="muted" dir="ltr">
          {data.number}
        </div>
        <h1 dir="rtl" lang="ar">
          كشف التسيير
        </h1>
      </div>

      <div className="box">
        <p>
          <b>Propriétaire · المالك:</b> <bdi>{data.owner.name}</bdi>
          {data.owner.nameAr ? (
            <>
              {" · "}
              <bdi lang="ar">{data.owner.nameAr}</bdi>
            </>
          ) : null}
        </p>
        {data.owner.address ? (
          <p>
            <b>Adresse · العنوان:</b> <bdi>{data.owner.address}</bdi>
          </p>
        ) : null}
        <p>
          <b>Période · الفترة:</b> {data.periodFrom ? `${formatDate(data.periodFrom)} → ` : "→ "}
          {formatDate(data.periodTo)} · <b>Établi le · حُرّر في:</b> {formatDate(data.issuedOn)}
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>
              Bail · <span lang="ar">العقد</span>
            </th>
            <th>
              Locataire · <span lang="ar">المستأجر</span>
            </th>
            <th>
              Quittance · <span lang="ar">الوصل</span>
            </th>
            <th>
              Encaissé le · <span lang="ar">تاريخ التحصيل</span>
            </th>
            <th className="num">
              Loyer · <span lang="ar">الإيجار</span>
            </th>
            <th className="num">
              Honoraires · <span lang="ar">الأتعاب</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l) => (
            <tr key={`${l.receiptNumber}-${l.reversal}`} className={l.reversal ? "reversal" : ""}>
              <td>
                <bdi dir="ltr">{l.leaseNumber}</bdi> · <bdi dir="ltr">{l.unitCode}</bdi>
              </td>
              <td>
                <bdi>{l.tenantName}</bdi>
                {l.reversal ? " (annulé · ملغى)" : ""}
              </td>
              <td dir="ltr">{l.receiptNumber}</td>
              <td dir="ltr">{formatDate(l.paidOn)}</td>
              <td className="num" dir="ltr">
                {money(l.amount)}
              </td>
              <td className="num" dir="ltr">
                {money(l.fee)} ({l.feeRateBp / 100} %)
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.extras.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>
                Autres retenues · <span lang="ar">اقتطاعات أخرى</span>
              </th>
              <th className="num">
                Montant · <span lang="ar">المبلغ</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.extras.map((e, index) => (
              <tr key={`${index}-${e.label}`}>
                <td>
                  <bdi>{e.label}</bdi>
                </td>
                <td className="num" dir="ltr">
                  {money(e.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <table>
        <tbody>
          <tr className="totals">
            <td>Loyers encaissés · الإيجارات المحصَّلة</td>
            <td className="num" dir="ltr">
              {money(data.collected)}
            </td>
          </tr>
          <tr className="totals">
            <td>Honoraires de gestion · أتعاب التسيير</td>
            <td className="num" dir="ltr">
              − {money(data.fees)}
            </td>
          </tr>
          {data.deductions > 0n ? (
            <tr className="totals">
              <td>Autres retenues · اقتطاعات أخرى</td>
              <td className="num" dir="ltr">
                − {money(data.deductions)}
              </td>
            </tr>
          ) : null}
          <tr className="net">
            <td>Net à reverser · الصافي المستحق</td>
            <td className="num" dir="ltr">
              {money(data.net)}
            </td>
          </tr>
        </tbody>
      </table>

      <p>Soit : {amountInWordsFr(data.net)}.</p>
      <p dir="rtl" lang="ar">
        أي: {amountInWordsAr(data.net)}.
      </p>
      {data.owner.rib ? (
        <p>
          <b>Virement au RIB · التحويل إلى الحساب:</b> <bdi dir="ltr">{data.owner.rib}</bdi>
        </p>
      ) : null}
    </PdfDocument>
  );
}
