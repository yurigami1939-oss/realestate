"use client";

import { useEffect, useState } from "react";

import { wilayaCode } from "@/lib/wilayas";
import { listCommunesAction } from "@/server/organizations/actions";
import type { CommuneSuggestion } from "@/server/organizations/communes";

/** The id of the communes' suggestions, for an input's `list`. */
export const COMMUNE_OPTIONS = "commune-options";

/**
 * The communes the organization's records already name, as suggestions (the field stays free
 * text): once a wilaya is typed, only its communes (and those whose wilaya is unknown); loaded
 * once when the form opens.
 */
export function CommuneOptions({ wilaya }: { wilaya?: string | null }) {
  const [communes, setCommunes] = useState<CommuneSuggestion[]>([]);
  useEffect(() => {
    let cancelled = false;
    void listCommunesAction({}).then((result) => {
      if (!cancelled && result.ok) setCommunes(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const code = wilayaCode(wilaya);
  const shown = code ? communes.filter((c) => c.wilaya === code || c.wilaya === null) : communes;
  return (
    <datalist id={COMMUNE_OPTIONS}>
      {shown.map((c) => (
        <option key={`${c.wilaya ?? ""}-${c.commune}`} value={c.commune} />
      ))}
    </datalist>
  );
}
