import "server-only";

import { formatDate } from "@/lib/dates";
import type { PunchTrade } from "@/lib/handovers";
import type { CompanyIdentity } from "@/server/organizations/settings";

import { PdfDocument } from "../document";

import {
  DELIVERY_CSS,
  type DeliveredUnit,
  DeliveredUnitBoxes,
  punchTradeLabels,
} from "./handover-pv";
import { Letterhead } from "./letterhead";

/** Everything printed on a PV de levée des réserves, already resolved. */
export type HandoverReleaseData = DeliveredUnit & {
  /** The PV de remise des clés it follows. */
  number: string;
  signedOn: string;
  closedOn: string;
  reserves: {
    position: number;
    location: string;
    description: string;
    trade: PunchTrade;
    status: "lifted" | "cancelled";
    liftedOn: string | null;
    cancelReason: string | null;
  }[];
};

/** Bilingual PV de levée des réserves, rendered once when the reserves are closed. */
export function HandoverReleaseTemplate({
  data,
  company,
}: {
  data: HandoverReleaseData;
  company: CompanyIdentity;
}) {
  return (
    <PdfDocument title={`Levée des réserves ${data.number}`} css={DELIVERY_CSS}>
      <Letterhead company={company} />

      <div className="title">
        <h1>PROCÈS-VERBAL DE LEVÉE DES RÉSERVES</h1>
        <div style={{ textAlign: "center" }}>
          <b>Le {formatDate(data.closedOn)}</b>
          <div className="muted">
            PV de remise <bdi dir="ltr">{data.number}</bdi> du {formatDate(data.signedOn)}
          </div>
        </div>
        <h1 dir="rtl" lang="ar">
          محضر رفع التحفظات
        </h1>
      </div>

      <DeliveredUnitBoxes data={data} />

      <div className="box">
        <h2>
          <span>Réserves</span>
          <span dir="rtl" lang="ar">
            التحفظات
          </span>
        </h2>
        <table>
          <thead>
            <tr>
              <th>N°</th>
              <th>
                Localisation · <span lang="ar">المكان</span>
              </th>
              <th>
                Description · <span lang="ar">الوصف</span>
              </th>
              <th>
                Corps d&apos;état · <span lang="ar">الاختصاص</span>
              </th>
              <th>
                Levée · <span lang="ar">الرفع</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.reserves.map((r) => (
              <tr key={r.position}>
                <td className="num">{r.position}</td>
                <td>{r.location}</td>
                <td>{r.description}</td>
                <td>
                  {punchTradeLabels[r.trade].fr} ·{" "}
                  <span lang="ar">{punchTradeLabels[r.trade].ar}</span>
                </td>
                <td>
                  {r.status === "lifted" && r.liftedOn ? (
                    <span className="num">{formatDate(r.liftedOn)}</span>
                  ) : (
                    <>
                      Annulée · <span lang="ar">أُلغي</span>
                      {r.cancelReason ? <div className="muted">{r.cancelReason}</div> : null}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p>
        Les parties constatent que les réserves ci-dessus sont levées, ou annulées d&apos;un commun
        accord : la livraison du bien est complète à la date du présent procès-verbal.
      </p>
      <p dir="rtl" lang="ar">
        يُثبت الطرفان أن التحفظات المذكورة أعلاه قد رُفعت أو أُلغيت باتفاقهما، وأن تسليم العقار تامّ
        في تاريخ هذا المحضر.
      </p>

      <div className="signatures">
        <div>
          Pour le promoteur · <span lang="ar">عن المرقّي</span>
        </div>
        <div>
          L&apos;acquéreur · <span lang="ar">المقتني</span>
          <div className="muted">
            Lu et approuvé · <span lang="ar">قُرئ وصودق عليه</span>
          </div>
        </div>
      </div>
    </PdfDocument>
  );
}
