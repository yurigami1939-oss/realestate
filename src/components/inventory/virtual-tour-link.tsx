import { Rotate3d } from "lucide-react";
import { useTranslations } from "next-intl";

/** A project's or a unit's virtual tour, opened on the provider's page (a new tab). */
export function VirtualTourLink({ url }: { url: string }) {
  const t = useTranslations("inventory");
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
      data-testid="virtual-tour"
    >
      <Rotate3d className="size-4" aria-hidden />
      {t("virtualTour")}
    </a>
  );
}
