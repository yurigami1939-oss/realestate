import "server-only";

import type { CertificateKind, CertificateSnapshot } from "@/lib/certificates";
import { formatDate } from "@/lib/dates";
import { amountInWordsAr, amountInWordsFr, type Centimes, formatDZD } from "@/lib/money";
import type { PaymentMethod } from "@/lib/sales";
import type { CompanyIdentity } from "@/server/organizations/settings";

import { PdfDocument } from "../document";
import { paymentMethodLabels } from "../payment-methods";

import { Letterhead } from "./letterhead";

/** A certificate as printed: its number, issue and frozen content. */
export type CertificateDocument = {
  kind: CertificateKind;
  number: string;
  issuedAt: Date;
  addressee: string | null;
  fromPortal: boolean;
  data: CertificateSnapshot;
};

const CSS = `
@page{size:A4;margin:16mm}
header{display:flex;justify-content:space-between;gap:16pt;margin-bottom:12pt}
.org{font-size:13pt;font-weight:700}
.title{display:flex;justify-content:space-between;align-items:center;border-block:1pt solid #171717;padding:6pt 0;margin-bottom:6pt}
.title h1{font-size:14pt;margin:0}
.ref{display:flex;justify-content:space-between;margin-bottom:12pt}
.to{margin:0 0 10pt auto;width:55%}
.box{border:1pt solid #d4d4d4;border-radius:4pt;padding:8pt;margin-bottom:10pt}
b{font-weight:600}
p{margin:0 0 6pt;line-height:1.45}
table{width:100%;border-collapse:collapse;margin:6pt 0 10pt}
th,td{border-bottom:0.75pt solid #d4d4d4;padding:3.5pt 5pt;text-align:start;vertical-align:top}
th{font-size:8.5pt;color:#525252;font-weight:600}
td.num,th.num{text-align:end;white-space:nowrap}
tfoot td{font-weight:700;border-bottom:none}
.kv{display:flex;justify-content:space-between;gap:8pt}
.closing{margin-top:10pt}
.signature{display:flex;justify-content:flex-end;margin-top:18pt}
.signature div{width:45%;text-align:center}
.stamp{height:62pt;border:1pt dashed #a3a3a3;border-radius:4pt;margin-top:4pt}
.note{border-top:0.75pt solid #d4d4d4;padding-top:4pt;margin-top:14pt}
.code{white-space:nowrap}
`;

const titles: Record<CertificateKind, { fr: string; ar: string }> = {
  reservation: { fr: "ATTESTATION DE RÉSERVATION", ar: "شهادة حجز" },
  payments: { fr: "ATTESTATION DE VERSEMENTS", ar: "شهادة دفع" },
  paid_in_full: { fr: "ATTESTATION DE PAIEMENT INTÉGRAL", ar: "شهادة تسديد كلي" },
  progress: { fr: "ATTESTATION D'AVANCEMENT DES TRAVAUX", ar: "شهادة تقدم الأشغال" },
  statement: { fr: "RELEVÉ DE COMPTE", ar: "كشف حساب" },
};

const unitTypes: Record<string, { fr: string; ar: string }> = {
  apartment: { fr: "appartement", ar: "شقة" },
  commercial: { fr: "local commercial", ar: "محل تجاري" },
  office: { fr: "bureau", ar: "مكتب" },
  parking: { fr: "place de parking", ar: "موقف سيارات" },
  storage: { fr: "cave", ar: "قبو" },
  villa: { fr: "villa", ar: "فيلا" },
};

const lineStates: Record<string, { fr: string; ar: string }> = {
  paid: { fr: "Réglée", ar: "مسددة" },
  overdue: { fr: "En retard", ar: "متأخرة" },
  due: { fr: "Exigible", ar: "مستحقة" },
  upcoming: { fr: "À venir", ar: "قادمة" },
  pending: { fr: "Selon travaux", ar: "حسب الأشغال" },
};

const big = (value: string): Centimes => BigInt(value);
const money = (value: string) => formatDZD(big(value), "fr");
const moneyAr = (value: string) => formatDZD(big(value), "ar");
const area = (value: string | null) => (value ? `${value.replace(".", ",")} m²` : null);
const floorFr = (floor: number) =>
  floor === 0 ? "rez-de-chaussée" : floor < 0 ? `sous-sol ${-floor}` : `étage ${floor}`;
const floorAr = (floor: number) =>
  floor === 0 ? "الطابق الأرضي" : floor < 0 ? `الطابق السفلي ${-floor}` : `الطابق ${floor}`;

/** The buyers as named in the text: « M. X, né(e) le … à …, NIN … ». */
function BuyersFr({ data }: { data: CertificateSnapshot }) {
  return (
    <>
      {data.buyers.map((b, i) => (
        <span key={`${b.name}-${i}`}>
          {i > 0 ? (i === data.buyers.length - 1 ? " et " : ", ") : null}
          <b>{b.name}</b>
          {b.birthDate
            ? `, né(e) le ${formatDate(b.birthDate)}${b.birthPlace ? ` à ${b.birthPlace}` : ""}`
            : ""}
          {b.nin ? (
            <>
              , NIN <bdi dir="ltr">{b.nin}</bdi>
            </>
          ) : null}
        </span>
      ))}
    </>
  );
}

function BuyersAr({ data }: { data: CertificateSnapshot }) {
  return (
    <>
      {data.buyers.map((b, i) => (
        <span key={`${b.name}-${i}`}>
          {i > 0 ? (i === data.buyers.length - 1 ? " و" : "، ") : null}
          <b>
            <bdi>{b.nameAr ?? b.name}</bdi>
          </b>
          {b.birthDate ? (
            <>
              ، المولود(ة) في <bdi dir="ltr">{formatDate(b.birthDate)}</bdi>
              {b.birthPlace ? (
                <>
                  {" "}
                  بـ<bdi>{b.birthPlace}</bdi>
                </>
              ) : null}
            </>
          ) : null}
          {b.nin ? (
            <>
              ، رقم التعريف الوطني <bdi dir="ltr">{b.nin}</bdi>
            </>
          ) : null}
        </span>
      ))}
    </>
  );
}

const placeOf = (data: CertificateSnapshot, separator: string) =>
  [data.project.address, data.project.commune, data.project.wilaya].filter(Boolean).join(separator);

/**
 * « le lot A-03-02 (appartement F3, 86,75 m², étage 3, Bloc A) du projet … sis … »; `article`
 * « du » after « de »; `short` without the project (already named in the sentence).
 */
function UnitFr({
  data,
  article = "le",
  short = false,
}: {
  data: CertificateSnapshot;
  article?: "le" | "du";
  short?: boolean;
}) {
  const u = data.unit;
  const details = [
    [unitTypes[u.type]?.fr ?? u.type, u.typology].filter(Boolean).join(" "),
    area(u.livingArea ?? u.usableArea),
    floorFr(u.floor),
    short ? null : u.building,
  ]
    .filter(Boolean)
    .join(", ");
  const place = placeOf(data, ", ");
  return (
    <>
      {article} lot{" "}
      <b dir="ltr" className="code">
        {u.code}
      </b>{" "}
      ({details})
      {data.annexes && data.annexes.length > 0 ? (
        <>
          {" "}
          et ses annexes{" "}
          {data.annexes.map((a, index) => (
            <span key={a.code}>
              {index > 0 ? ", " : ""}
              {unitTypes[a.type]?.fr ?? a.type}{" "}
              <b dir="ltr" className="code">
                {a.code}
              </b>
            </span>
          ))}
        </>
      ) : null}
      {short ? null : (
        <>
          {" "}
          du projet « {data.project.name} »{place ? `, sis ${place}` : ""}
        </>
      )}
    </>
  );
}

function UnitAr({ data, short = false }: { data: CertificateSnapshot; short?: boolean }) {
  const u = data.unit;
  const details = [
    [unitTypes[u.type]?.ar ?? u.type, u.typology].filter(Boolean).join(" "),
    area(u.livingArea ?? u.usableArea),
    floorAr(u.floor),
    short ? null : u.building,
  ]
    .filter(Boolean)
    .join("، ");
  const place = placeOf(data, "، ");
  return (
    <>
      الوحدة{" "}
      <bdi dir="ltr" className="code">
        {u.code}
      </bdi>{" "}
      (<bdi>{details}</bdi>)
      {data.annexes && data.annexes.length > 0 ? (
        <>
          {" "}
          وملحقاتها{" "}
          {data.annexes.map((a, index) => (
            <span key={a.code}>
              {index > 0 ? "، " : ""}
              {unitTypes[a.type]?.ar ?? a.type}{" "}
              <bdi dir="ltr" className="code">
                {a.code}
              </bdi>
            </span>
          ))}
        </>
      ) : null}
      {short ? null : (
        <>
          {" "}
          من مشروع «<bdi>{data.project.name}</bdi>»
          {place ? (
            <>
              {" "}
              الكائن بـ<bdi>{place}</bdi>
            </>
          ) : null}
        </>
      )}
    </>
  );
}

function PaymentsTable({ data }: { data: CertificateSnapshot }) {
  return (
    <table>
      <thead>
        <tr>
          <th>
            Date · <span lang="ar">التاريخ</span>
          </th>
          <th>
            Mode · <span lang="ar">طريقة الدفع</span>
          </th>
          <th>
            Reçu · <span lang="ar">الوصل</span>
          </th>
          <th className="num">
            Montant · <span lang="ar">المبلغ</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {data.payments.map((p, i) => {
          const method = paymentMethodLabels[p.method as PaymentMethod];
          return (
            <tr key={`${p.paidOn}-${i}`}>
              <td dir="ltr">{formatDate(p.paidOn)}</td>
              <td>
                {method?.fr ?? p.method}
                {p.reference ? (
                  <>
                    {" "}
                    <bdi dir="ltr">{p.reference}</bdi>
                  </>
                ) : null}
                {p.pendingCheque ? (
                  <div className="muted">
                    sous réserve d&apos;encaissement · <span lang="ar">رهن التحصيل</span>
                  </div>
                ) : null}
              </td>
              <td dir="ltr">{p.receipt ?? "—"}</td>
              <td className="num" dir="ltr">
                {money(p.amount)}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={3}>Total versé · مجموع المدفوع</td>
          <td className="num" dir="ltr">
            {money(data.totals.paid)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function ScheduleTable({ data }: { data: CertificateSnapshot }) {
  return (
    <table>
      <thead>
        <tr>
          <th>
            Échéance · <span lang="ar">الدفعة</span>
          </th>
          <th>
            Exigible le · <span lang="ar">الاستحقاق</span>
          </th>
          <th className="num">
            Montant · <span lang="ar">المبلغ</span>
          </th>
          <th className="num">
            Réglé · <span lang="ar">المسدد</span>
          </th>
          <th className="num">
            Reste · <span lang="ar">المتبقي</span>
          </th>
          <th>
            État · <span lang="ar">الحالة</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {data.installments.map((line, i) => (
          <tr key={`${line.label}-${i}`}>
            <td>
              <bdi>{line.label}</bdi>
            </td>
            <td dir="ltr">{line.dueOn ? formatDate(line.dueOn) : "—"}</td>
            <td className="num" dir="ltr">
              {money(line.amount)}
            </td>
            <td className="num" dir="ltr">
              {money(line.paid)}
            </td>
            <td className="num" dir="ltr">
              {money(line.remaining)}
            </td>
            <td>
              {lineStates[line.state]?.fr} · <span lang="ar">{lineStates[line.state]?.ar}</span>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={2}>Total · المجموع</td>
          <td className="num" dir="ltr">
            {money(data.sale.price)}
          </td>
          <td className="num" dir="ltr">
            {money(data.totals.paid)}
          </td>
          <td className="num" dir="ltr">
            {money(data.totals.remaining)}
          </td>
          <td />
        </tr>
      </tfoot>
    </table>
  );
}

/** The paragraphs that make each certificate (French, then Arabic). */
function Body({ doc }: { doc: CertificateDocument }) {
  const { data } = doc;
  const contractFr = (
    <>
      par contrat de réservation n° <b dir="ltr">{data.sale.number}</b> du{" "}
      {formatDate(data.sale.reservedOn)}
    </>
  );
  const contractAr = (
    <>
      بموجب عقد الحجز رقم <bdi dir="ltr">{data.sale.number}</bdi> المؤرخ في{" "}
      <bdi dir="ltr">{formatDate(data.sale.reservedOn)}</bdi>
    </>
  );
  const vspFr =
    data.sale.saleSignedOn !== null ? (
      <p>
        La vente sur plans a été conclue par acte notarié du {formatDate(data.sale.saleSignedOn)}
        {data.sale.saleNotary ? ` (Maître ${data.sale.saleNotary})` : ""}
        {data.sale.saleNumber ? (
          <>
            , notre référence <bdi dir="ltr">{data.sale.saleNumber}</bdi>
          </>
        ) : null}
        .
      </p>
    ) : null;
  const vspAr =
    data.sale.saleSignedOn !== null ? (
      <p dir="rtl" lang="ar">
        وقد أُبرم عقد البيع على التصاميم بعقد توثيقي مؤرخ في{" "}
        <bdi dir="ltr">{formatDate(data.sale.saleSignedOn)}</bdi>
        {data.sale.saleNumber ? (
          <>
            ، مرجعنا <bdi dir="ltr">{data.sale.saleNumber}</bdi>
          </>
        ) : null}
        .
      </p>
    ) : null;

  switch (doc.kind) {
    case "reservation":
      return (
        <>
          <p>
            <BuyersFr data={data} /> a (ont) réservé auprès de notre société <UnitFr data={data} />,{" "}
            {contractFr}, au prix de <b dir="ltr">{money(data.sale.price)}</b> (
            {amountInWordsFr(big(data.sale.price))}).
          </p>
          {vspFr}
          <p dir="rtl" lang="ar">
            <BuyersAr data={data} /> قد حجز(وا) لدى شركتنا <UnitAr data={data} />، {contractAr}،
            بسعر <bdi>{moneyAr(data.sale.price)}</bdi> ({amountInWordsAr(big(data.sale.price))}
            ).
          </p>
          {vspAr}
        </>
      );
    case "payments":
      return (
        <>
          <p>
            <BuyersFr data={data} /> a (ont) versé à notre société, au titre de l&apos;acquisition{" "}
            <UnitFr data={data} article="du" /> ({contractFr}), la somme de{" "}
            <b dir="ltr">{money(data.totals.paid)}</b> ({amountInWordsFr(big(data.totals.paid))}) à
            la date de la présente, détaillée ci-dessous. Le prix convenu est de{" "}
            <span dir="ltr">{money(data.sale.price)}</span> ; le reste à payer s&apos;élève à{" "}
            <b dir="ltr">{money(data.totals.remaining)}</b>.
          </p>
          <p dir="rtl" lang="ar">
            <BuyersAr data={data} /> قد دفع(وا) لشركتنا، بعنوان اقتناء <UnitAr data={data} /> (
            {contractAr})، مبلغ <bdi>{moneyAr(data.totals.paid)}</bdi> (
            {amountInWordsAr(big(data.totals.paid))}) إلى تاريخ هذه الشهادة، حسب التفصيل أدناه.
            السعر المتفق عليه <bdi>{moneyAr(data.sale.price)}</bdi>، والمبلغ المتبقي{" "}
            <bdi>{moneyAr(data.totals.remaining)}</bdi>.
          </p>
          <PaymentsTable data={data} />
        </>
      );
    case "paid_in_full":
      return (
        <>
          <p>
            <BuyersFr data={data} /> s&apos;est (se sont) intégralement acquitté(s) du prix{" "}
            <UnitFr data={data} article="du" /> ({contractFr}), soit{" "}
            <b dir="ltr">{money(data.sale.price)}</b> ({amountInWordsFr(big(data.sale.price))}).
            Aucune somme ne reste due au titre de ce prix à la date de la présente.
          </p>
          {vspFr}
          <p dir="rtl" lang="ar">
            <BuyersAr data={data} /> قد سدد(وا) كامل سعر <UnitAr data={data} /> ({contractAr})، أي{" "}
            <bdi>{moneyAr(data.sale.price)}</bdi> ({amountInWordsAr(big(data.sale.price))}
            )، ولا يبقى أي مبلغ مستحق بعنوان هذا السعر إلى تاريخ هذه الشهادة.
          </p>
          {vspAr}
          <PaymentsTable data={data} />
        </>
      );
    case "progress": {
      return (
        <>
          <p>
            Les travaux du bâtiment « {data.unit.building} » du projet « {data.project.name} »
            {placeOf(data, ", ") ? `, sis ${placeOf(data, ", ")}` : ""}, où se trouve{" "}
            <UnitFr data={data} short /> réservé par <BuyersFr data={data} /> ({contractFr}
            ),{" "}
            {data.progress.percent !== null && data.progress.reportedOn ? (
              <>
                sont avancés à <b>{data.progress.percent} %</b> au{" "}
                {formatDate(data.progress.reportedOn)}.
              </>
            ) : (
              <>n&apos;ont pas encore fait l&apos;objet d&apos;un constat d&apos;avancement.</>
            )}
          </p>
          <p dir="rtl" lang="ar">
            أشغال العمارة «<bdi>{data.unit.building}</bdi>» من مشروع «<bdi>{data.project.name}</bdi>
            »، التي تقع فيها <UnitAr data={data} short /> المحجوزة من طرف <BuyersAr data={data} />،{" "}
            {data.progress.percent !== null && data.progress.reportedOn ? (
              <>
                بلغت نسبة <b dir="ltr">{data.progress.percent} %</b> بتاريخ{" "}
                <bdi dir="ltr">{formatDate(data.progress.reportedOn)}</bdi>.
              </>
            ) : (
              <>لم تكن بعد محل معاينة للتقدم.</>
            )}
          </p>
          {data.progress.milestones.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>
                    Étape des travaux · <span lang="ar">مرحلة الأشغال</span>
                  </th>
                  <th>
                    Prévue · <span lang="ar">المتوقعة</span>
                  </th>
                  <th>
                    Atteinte le · <span lang="ar">أنجزت في</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.progress.milestones.map((m, i) => (
                  <tr key={`${m.name}-${i}`}>
                    <td>
                      <bdi>{m.name}</bdi>
                    </td>
                    <td dir="ltr">{m.plannedOn ? formatDate(m.plannedOn) : "—"}</td>
                    <td dir="ltr">{m.validatedOn ? formatDate(m.validatedOn) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      );
    }
    case "statement":
      return (
        <>
          <div className="box">
            <p>
              <BuyersFr data={data} /> · <UnitFr data={data} /> · {contractFr}
              {data.sale.saleNumber ? (
                <>
                  {" "}
                  · <bdi dir="ltr">{data.sale.saleNumber}</bdi>
                </>
              ) : null}
            </p>
            <div className="kv">
              <span>Prix convenu · السعر المتفق عليه</span>
              <b dir="ltr">{money(data.sale.price)}</b>
            </div>
            <div className="kv">
              <span>Total versé · مجموع المدفوع</span>
              <b dir="ltr">{money(data.totals.paid)}</b>
            </div>
            <div className="kv">
              <span>Reste à payer · المبلغ المتبقي</span>
              <b dir="ltr">{money(data.totals.remaining)}</b>
            </div>
            {big(data.totals.overdue) > 0n ? (
              <div className="kv">
                <span>Dont en retard · منها متأخرة</span>
                <b dir="ltr">{money(data.totals.overdue)}</b>
              </div>
            ) : null}
          </div>
          <ScheduleTable data={data} />
          {data.payments.length > 0 ? <PaymentsTable data={data} /> : null}
        </>
      );
  }
}

/** Bilingual certificate (attestation) or statement of account on a sale. */
export function CertificateTemplate({
  doc,
  company,
}: {
  doc: CertificateDocument;
  company: CompanyIdentity;
}) {
  const title = titles[doc.kind];
  const attestation = doc.kind !== "statement";
  const place = company.wilaya ?? company.address;
  return (
    <PdfDocument title={doc.number} css={CSS}>
      <Letterhead company={company} />

      <div className="title">
        <h1>{title.fr}</h1>
        <h1 dir="rtl" lang="ar">
          {title.ar}
        </h1>
      </div>
      <div className="ref">
        <span>
          N° <b dir="ltr">{doc.number}</b>
        </span>
        <span className="muted">
          {attestation ? "Délivrée le" : "Arrêté au"} {formatDate(doc.issuedAt)} ·{" "}
          {attestation ? "سلمت في" : "موقوف في"} {formatDate(doc.issuedAt)}
        </span>
      </div>

      {doc.addressee ? (
        <div className="to">
          À l&apos;attention de · <span lang="ar">إلى عناية</span> : <b>{doc.addressee}</b>
        </div>
      ) : null}

      {attestation ? (
        <>
          <p>
            Nous soussignés, <b>{company.legalName ?? company.name}</b>, promoteur immobilier
            {company.rcNumber ? (
              <>
                , RC n° <bdi dir="ltr">{company.rcNumber}</bdi>
              </>
            ) : null}
            , attestons que :
          </p>
          <p dir="rtl" lang="ar">
            نحن الممضين أسفله، <b>{company.legalName ?? company.name}</b>، مرقٍ عقاري
            {company.rcNumber ? (
              <>
                ، سجل تجاري رقم <bdi dir="ltr">{company.rcNumber}</bdi>
              </>
            ) : null}
            ، نشهد أن:
          </p>
        </>
      ) : null}

      <Body doc={doc} />

      {attestation ? (
        <div className="closing">
          <p>
            La présente attestation est délivrée à l&apos;intéressé(e), sur sa demande, pour servir
            et valoir ce que de droit.
          </p>
          <p dir="rtl" lang="ar">
            سلّمت هذه الشهادة للمعني(ة) بناءً على طلبه(ا) لاستعمالها في حدود ما يسمح به القانون.
          </p>
          <div className="signature">
            <div>
              {place ? `Fait à ${place}, le ${formatDate(doc.issuedAt)}` : null}
              <div>Le Gérant · المسير</div>
              <div className="stamp" />
            </div>
          </div>
        </div>
      ) : (
        <p className="muted note">
          {doc.fromPortal
            ? "Relevé établi depuis l'espace client ; il ne constitue pas une attestation."
            : "Relevé établi sauf erreur ou omission ; il ne constitue pas une attestation."}
          <br />
          <span dir="rtl" lang="ar">
            {doc.fromPortal
              ? "كشف مستخرج من فضاء الزبائن؛ لا يُعدّ شهادة."
              : "كشف معدّ مع حفظ الخطأ أو السهو؛ لا يُعدّ شهادة."}
          </span>
        </p>
      )}
    </PdfDocument>
  );
}
