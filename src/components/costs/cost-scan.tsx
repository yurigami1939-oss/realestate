import { DocumentScan } from "@/components/obligations/document-scan";

/** The signed contract's or a progress invoice's scan (cost:update to attach or replace). */
export function CostScan({
  kind,
  entityId,
  fileId,
  editable,
}: {
  kind: "contract" | "invoice";
  entityId: string;
  fileId: string | null;
  editable: boolean;
}) {
  return (
    <DocumentScan
      purpose={kind === "contract" ? "works_contract.scan" : "works_invoice.scan"}
      entityId={entityId}
      fileId={fileId}
      editable={editable}
    />
  );
}
