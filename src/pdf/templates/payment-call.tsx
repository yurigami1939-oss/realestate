import "server-only";

import { formatDate } from "@/lib/dates";
import { amountInWordsAr, amountInWordsFr, type Centimes, formatDZD } from "@/lib/money";
import type { CompanyIdentity } from "@/server/organizations/settings";

import { PdfDocument } from "../document";

import { Letterhead } from "./letterhead";

/** Everything printed on a payment call, already resolved (no lookups in templates). */
export type PaymentCallData = {
  number: string;
  issuedAt: Date;
  saleNumber: string;
  saleDeedNumber: string | null;
  projectName: string;
  buildingName: string;
  unitCode: string;
  milestoneName: string;
  validatedOn: string;
  label: string;
  amount: Centimes;
  settled: Centimes;
  called: Centimes;
  dueOn: string;
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
.called{font-size:16pt;font-weight:700;text-align:center;border:1pt solid #171717;border-radius:4pt;padding:8pt;margin:10pt 0}
.signatures{display:flex;justify-content:flex-end;margin-top:28pt}
.signatures div{width:40%;border-top:1pt solid #a3a3a3;padding-top:4pt}
`;

/** Bilingual payment call (appel de fonds) sent when a construction milestone is reached. */
export function PaymentCallTemplate({
  data,
  company,
}: {
  data: PaymentCallData;
  company: CompanyIdentity;
}) {
  const money = (v: Centimes) => formatDZD(v, "fr");
  const contract = data.saleDeedNumber
    ? `VSP ${data.saleDeedNumber} (réservation ${data.saleNumber})`
    : `réservation ${data.saleNumber}`;
  return (
    <PdfDocument title={data.number} css={CSS}>
      <Letterhead company={company} />

      <div className="title">
        <h1>APPEL DE FONDS</h1>
        <div style={{ textAlign: "center" }}>
          <b>N° {data.number}</b>
          <div className="muted">Le {formatDate(data.issuedAt)}</div>
        </div>
        <h1 dir="rtl" lang="ar">
          طلب دفع
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
          <b>Objet :</b> {data.projectName} · {data.buildingName} · lot{" "}
          <b dir="ltr">{data.unitCode}</b> · {contract}
        </p>
        <p dir="rtl" lang="ar">
          <b>الموضوع:</b> <bdi>{data.projectName}</bdi> · الوحدة <bdi>{data.unitCode}</bdi> · الحجز{" "}
          <bdi>{data.saleNumber}</bdi>
        </p>
      </div>

      <p>
        Nous avons le plaisir de vous informer de l&apos;achèvement de l&apos;étape «{" "}
        <b>{data.milestoneName}</b> » le {formatDate(data.validatedOn)}. Conformément à
        l&apos;échéancier de votre contrat, nous vous prions de bien vouloir régler la somme
        ci-dessous au plus tard le <b>{formatDate(data.dueOn)}</b>.
      </p>
      <p dir="rtl" lang="ar">
        يسرنا إعلامكم بإنجاز مرحلة «<bdi>{data.milestoneName}</bdi>» بتاريخ{" "}
        {formatDate(data.validatedOn)}. ووفقاً لجدول الدفعات المنصوص عليه في عقدكم، نرجو منكم تسديد
        المبلغ أدناه في أجل أقصاه <b>{formatDate(data.dueOn)}</b>.
      </p>

      <table>
        <thead>
          <tr>
            <th>
              Échéance · <span lang="ar">الدفعة</span>
            </th>
            <th className="num">
              Montant · <span lang="ar">المبلغ</span>
            </th>
            <th className="num">
              Déjà réglé · <span lang="ar">المدفوع مسبقاً</span>
            </th>
            <th className="num">
              À régler · <span lang="ar">المطلوب</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <bdi>{data.label}</bdi>
            </td>
            <td className="num" dir="ltr">
              {money(data.amount)}
            </td>
            <td className="num" dir="ltr">
              {money(data.settled)}
            </td>
            <td className="num" dir="ltr">
              <b>{money(data.called)}</b>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="called" dir="ltr">
        {money(data.called)}
      </div>
      <p>Soit : {amountInWordsFr(data.called)}.</p>
      <p dir="rtl" lang="ar">
        أي: {amountInWordsAr(data.called)}.
      </p>

      <p className="muted">
        Règlement à la caisse de la société (espèces, chèque, virement, CCP) ; un reçu vous sera
        remis pour chaque paiement.
      </p>
      <p className="muted" dir="rtl" lang="ar">
        يتم التسديد لدى صندوق الشركة (نقداً، بصك، بتحويل، عبر الحساب البريدي الجاري)، ويُسلَّم لكم
        وصل عن كل دفعة.
      </p>

      <div className="signatures">
        <div className="muted">Le promoteur · المرقي</div>
      </div>
    </PdfDocument>
  );
}
