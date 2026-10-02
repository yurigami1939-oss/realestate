import "server-only";

import { formatDate } from "@/lib/dates";
import { amountInWordsAr, amountInWordsFr, type Centimes, formatDZD } from "@/lib/money";
import type { CompanyIdentity } from "@/server/organizations/settings";

import { PdfDocument } from "../document";

import { Letterhead } from "./letterhead";

/** Everything printed on a charge call, already resolved (no lookups in templates). */
export type ChargeCallData = {
  number: string;
  issuedOn: string;
  dueOn: string;
  residenceName: string;
  residenceAddress: string;
  buildingName: string;
  unitCode: string;
  share: number;
  shareBasis: number;
  period: { fr: string; ar: string };
  year: number;
  /** Null: no co-owner on the issue day (a unit the company still owns). */
  addressee: { name: string; nameAr: string | null; address: string | null } | null;
  lines: { label: string; labelAr: string | null; amount: Centimes }[];
  amount: Centimes;
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
.called{font-size:16pt;font-weight:700;text-align:center;border:1pt solid #171717;border-radius:4pt;padding:8pt;margin:10pt 0}
.signatures{display:flex;justify-content:flex-end;margin-top:28pt}
.signatures div{width:40%;border-top:1pt solid #a3a3a3;padding-top:4pt}
`;

/** Bilingual charge call (appel de charges) of one unit for one period. */
export function ChargeCallTemplate({
  data,
  company,
}: {
  data: ChargeCallData;
  company: CompanyIdentity;
}) {
  const money = (v: Centimes) => formatDZD(v, "fr");
  return (
    <PdfDocument title={data.number} css={CSS}>
      <Letterhead company={company} />

      <div className="title">
        <h1>APPEL DE CHARGES</h1>
        <div style={{ textAlign: "center" }}>
          <b>N° {data.number}</b>
          <div className="muted">Le {formatDate(data.issuedOn)}</div>
        </div>
        <h1 dir="rtl" lang="ar">
          طلب تسديد الأعباء
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
          <b>Objet :</b> charges de copropriété · {data.residenceName} · {data.buildingName} · lot{" "}
          <b dir="ltr">{data.unitCode}</b> · {data.period.fr} · tantièmes{" "}
          <span dir="ltr">
            {data.share} / {data.shareBasis}
          </span>
        </p>
        <p dir="rtl" lang="ar">
          <b>الموضوع:</b> أعباء الملكية المشتركة · <bdi>{data.residenceName}</bdi> · الوحدة{" "}
          <bdi>{data.unitCode}</bdi> · {data.period.ar} · الحصص{" "}
          <bdi dir="ltr">
            {data.share} / {data.shareBasis}
          </bdi>
        </p>
      </div>

      <p>
        Conformément au budget {data.year} de la résidence, nous vous prions de bien vouloir régler
        les charges ci-dessous au plus tard le <b>{formatDate(data.dueOn)}</b>.
      </p>
      <p dir="rtl" lang="ar">
        وفقاً لميزانية الإقامة لسنة {data.year}، نرجو منكم تسديد الأعباء المبينة أدناه في أجل أقصاه{" "}
        <b>{formatDate(data.dueOn)}</b>.
      </p>

      <table>
        <thead>
          <tr>
            <th>
              Charges · <span lang="ar">الأعباء</span>
            </th>
            <th className="num">
              Montant · <span lang="ar">المبلغ</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line) => (
            <tr key={line.label}>
              <td>
                {line.label}
                {line.labelAr ? (
                  <>
                    {" · "}
                    <bdi dir="rtl" lang="ar">
                      {line.labelAr}
                    </bdi>
                  </>
                ) : null}
              </td>
              <td className="num" dir="ltr">
                {money(line.amount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>
              Total · <span lang="ar">المجموع</span>
            </td>
            <td className="num" dir="ltr">
              {money(data.amount)}
            </td>
          </tr>
        </tfoot>
      </table>

      <div className="called" dir="ltr">
        {money(data.amount)}
      </div>
      <p>Soit : {amountInWordsFr(data.amount)}.</p>
      <p dir="rtl" lang="ar">
        أي: {amountInWordsAr(data.amount)}.
      </p>

      <p className="muted">
        Règlement auprès du gestionnaire de la résidence (espèces, chèque, virement, CCP) ; un reçu
        vous sera remis pour chaque paiement.
      </p>
      <p className="muted" dir="rtl" lang="ar">
        يتم التسديد لدى مسير الإقامة (نقداً، بصك، بتحويل، عبر الحساب البريدي الجاري)، ويُسلَّم لكم
        وصل عن كل دفعة.
      </p>

      <div className="signatures">
        <div className="muted">Le gestionnaire · المسير</div>
      </div>
    </PdfDocument>
  );
}
