import { MessageCircle, Phone } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { formatPhone, phoneHref, whatsappHref } from "@/lib/phone";

/** Phone number shown the national way, always left-to-right. */
export function PhoneText({ value }: { value: string }) {
  return (
    <bdi dir="ltr" className="whitespace-nowrap">
      {formatPhone(value)}
    </bdi>
  );
}

/** Call and WhatsApp buttons for a number. */
export function PhoneActions({ value }: { value: string }) {
  const t = useTranslations("crm.leads");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="sm">
        <a href={phoneHref(value)}>
          <Phone data-icon="inline-start" />
          <PhoneText value={value} />
        </a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={whatsappHref(value)} target="_blank" rel="noopener noreferrer">
          <MessageCircle data-icon="inline-start" />
          {t("whatsapp")}
        </a>
      </Button>
    </div>
  );
}
