import { useLocale, useTranslations } from "next-intl";

import { followUpChannels, leadSources, leadStages, lostReasons, visitStatuses } from "@/lib/crm";
import { formatDateTime } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import type { LeadDetail } from "@/server/crm/queries";

type Activity = LeadDetail["activities"][number];

const oneOf = <const T extends readonly string[]>(values: T, v: unknown): T[number] | null =>
  typeof v === "string" && (values as readonly string[]).includes(v) ? v : null;

function ActivityLine({ activity }: { activity: Activity }) {
  const t = useTranslations("crm");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const d = activity.data ?? {};
  const text = (key: string) => (typeof d[key] === "string" ? (d[key] as string) : null);
  const date = (key: string) => {
    const v = text(key);
    return v ? formatDateTime(new Date(v)) : "";
  };
  const stage = (key: string) => {
    const v = oneOf(leadStages, d[key]);
    return v ? t(`stage.${v}`) : "—";
  };
  const amount = (key: string) => {
    const v = text(key);
    return v && /^\d+$/.test(v) ? formatDZD(BigInt(v), locale) : "—";
  };
  const detail = (value: string | null) =>
    value ? <p className="mt-1 whitespace-pre-line text-muted-foreground">{value}</p> : null;

  switch (activity.type) {
    case "created": {
      const source = oneOf(leadSources, d.source);
      return (
        <p>
          {t("leads.activity.created")}
          {source ? ` · ${t(`source.${source}`)}` : ""}
        </p>
      );
    }
    case "updated":
      return <p>{t("leads.activity.updated")}</p>;
    case "stage_changed": {
      const reason = oneOf(lostReasons, d.lostReason);
      return (
        <>
          <p>{t("leads.activity.stage_changed", { from: stage("from"), to: stage("to") })}</p>
          {detail(
            [reason ? t(`lostReason.${reason}`) : null, text("note")].filter(Boolean).join(" · ") ||
              null,
          )}
        </>
      );
    }
    case "assigned":
      return <p>{t("leads.activity.assigned")}</p>;
    case "note":
      return (
        <>
          <p>{t("leads.activity.note")}</p>
          {detail(text("text"))}
        </>
      );
    case "visit_scheduled":
      return <p>{t("leads.activity.visit_scheduled", { date: date("scheduledAt") })}</p>;
    case "visit_updated": {
      const status = oneOf(visitStatuses, d.status);
      return (
        <>
          <p>
            {t("leads.activity.visit_updated", {
              status: status ? t(`visitStatus.${status}`) : "—",
            })}
          </p>
          {detail(text("outcome"))}
        </>
      );
    }
    case "follow_up_created": {
      const channel = oneOf(followUpChannels, d.channel);
      return (
        <p>
          {t("leads.activity.follow_up_created", { date: date("dueAt") })}
          {channel ? ` · ${t(`channel.${channel}`)}` : ""}
        </p>
      );
    }
    case "follow_up_done": {
      const channel = oneOf(followUpChannels, d.channel);
      return (
        <>
          <p>
            {t("leads.activity.follow_up_done")}
            {channel ? ` · ${t(`channel.${channel}`)}` : ""}
          </p>
          {detail(text("outcome"))}
        </>
      );
    }
    case "quotation_issued":
      return <p>{t("leads.activity.quotation_issued", { number: text("number") ?? "" })}</p>;
    case "quotation_cancelled":
      return <p>{t("leads.activity.quotation_cancelled", { number: text("number") ?? "" })}</p>;
    case "merged":
      return <p>{t("leads.activity.merged", { name: text("sourceName") ?? "" })}</p>;
    case "option_placed":
      return (
        <p>
          {t("leads.activity.option_placed", {
            unit: text("unitCode") ?? "—",
            date: date("expiresAt"),
          })}
        </p>
      );
    case "option_ended": {
      const reason = oneOf(["expired", "cancelled", "converted"] as const, d.reason);
      return (
        <>
          <p>
            {t("leads.activity.option_ended", {
              unit: text("unitCode") ?? "—",
              reason: reason ? t(`leads.activity.option_reason.${reason}`) : "—",
            })}
          </p>
          {detail(text("note"))}
        </>
      );
    }
    case "reserved":
      return (
        <p>
          {t("leads.activity.reserved", {
            number: text("number") ?? "",
            unit: text("unitCode") ?? "—",
          })}
        </p>
      );
    case "sale_signed":
      return <p>{t("leads.activity.sale_signed", { unit: text("unitCode") ?? "—" })}</p>;
    case "withdrawn":
      return <p>{t("leads.activity.withdrawn", { number: text("number") ?? "" })}</p>;
    case "discount_requested":
      return (
        <p>
          {t("leads.activity.discount_requested", {
            amount: amount("amount"),
            unit: text("unitCode") ?? "—",
          })}
        </p>
      );
    case "discount_decided":
      return (
        <>
          <p>
            {d.approved === true
              ? t("leads.activity.discount_approved", {
                  amount: amount("amount"),
                  unit: text("unitCode") ?? "—",
                })
              : t("leads.activity.discount_rejected", { unit: text("unitCode") ?? "—" })}
          </p>
          {detail(text("note"))}
        </>
      );
  }
}

export function Timeline({ activities }: { activities: Activity[] }) {
  return (
    <ol className="space-y-4 border-s ps-4" data-testid="lead-timeline">
      {activities.map((a) => (
        <li key={a.id} className="relative text-sm">
          <span
            className="absolute -start-[21px] top-1.5 size-2 rounded-full bg-muted-foreground/60"
            aria-hidden
          />
          <ActivityLine activity={a} />
          <p className="text-xs text-muted-foreground">
            {formatDateTime(a.createdAt)}
            {a.actorName ? ` · ${a.actorName}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
