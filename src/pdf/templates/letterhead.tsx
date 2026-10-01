import "server-only";

import type { CompanyIdentity } from "@/server/organizations/settings";

/**
 * Company header of every issued document: logo (when set), legal name, address, phone and
 * the legal identifiers. The template's CSS styles `header`, `.org` and `.muted`.
 */
export function Letterhead({ company }: { company: CompanyIdentity }) {
  return (
    <header>
      <div style={{ display: "flex", alignItems: "center", gap: "10pt" }}>
        {company.logo ? (
          // Static HTML printed by Chromium (not a Next page): a plain image, embedded as data.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logo}
            alt=""
            style={{ maxHeight: "46pt", maxWidth: "130pt", objectFit: "contain" }}
          />
        ) : null}
        <div>
          <div className="org">{company.legalName ?? company.name}</div>
          <div className="muted">
            {[company.address, company.wilaya].filter(Boolean).join(", ")}
          </div>
          {company.phone ? <div className="muted">Tél. {company.phone}</div> : null}
        </div>
      </div>
      <div className="muted" style={{ textAlign: "end" }}>
        {company.rcNumber ? `RC ${company.rcNumber}` : ""}{" "}
        {company.nif ? `· NIF ${company.nif}` : ""}
        <br />
        {company.nis ? `NIS ${company.nis}` : ""}{" "}
        {company.aiNumber ? `· AI ${company.aiNumber}` : ""}
      </div>
    </header>
  );
}
