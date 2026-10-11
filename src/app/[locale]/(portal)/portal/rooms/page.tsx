import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CancelMyBookingButton, PortalBookingDialog } from "@/components/portal/room-booking";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toLocale } from "@/i18n/locales";
import { formatDate, todayInAlgiers } from "@/lib/dates";
import { requirePortalCtx } from "@/server/portal/page-guard";
import { listPortalRooms, timeOf } from "@/server/rooms/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.rooms");
  return { title: t("title") };
}

/** The common rooms of the resident's residences: the slots taken, booking, its own bookings. */
export default async function PortalRoomsPage({ params }: PageProps<"/[locale]/portal/rooms">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePortalCtx();
  const { rooms, mine } = await listPortalRooms(ctx);
  const t = await getTranslations("portal.rooms");
  const tr = await getTranslations("rooms");
  const today = todayInAlgiers();
  const slot = (b: { startsAt: Date; endsAt: Date }) =>
    tr("slot", { day: formatDate(b.startsAt), from: timeOf(b.startsAt), to: timeOf(b.endsAt) });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-large-title">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      {rooms.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        rooms.map((room) => (
          <Card key={room.id} data-room={room.name}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <CardTitle>
                  {room.name} · {room.residenceName}
                </CardTitle>
                <div className="text-sm text-muted-foreground">
                  <span dir="ltr">
                    {tr("hours", { from: room.opensAt, to: room.closesAt, hours: room.maxHours })}
                  </span>
                  {room.capacity ? ` · ${tr("capacity", { count: room.capacity })}` : ""} ·{" "}
                  {room.needsApproval ? tr("approval") : tr("instant")}
                </div>
                {room.description ? (
                  <p className="text-sm whitespace-pre-line">{room.description}</p>
                ) : null}
              </div>
              <PortalBookingDialog room={{ id: room.id, name: room.name }} today={today} />
            </CardHeader>
            <CardContent>
              <div className="mb-1 text-sm font-medium">{t("taken")}</div>
              {room.taken.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noTaken")}</p>
              ) : (
                <ul className="space-y-0.5 text-sm" dir="ltr">
                  {room.taken.map((b) => (
                    <li key={`${b.startsAt.toISOString()}`}>{slot(b)}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t("mine")}</CardTitle>
        </CardHeader>
        <CardContent>
          {mine.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noMine")}</p>
          ) : (
            <ul className="divide-y text-sm" data-testid="my-bookings">
              {mine.map((b) => (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                  data-status={b.status}
                >
                  <div>
                    <div className="font-medium">
                      {b.roomName} · <span dir="ltr">{slot(b)}</span>
                    </div>
                    <div className="text-muted-foreground">
                      {b.purpose}
                      {b.decisionNote ? ` · ${b.decisionNote}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{tr(`status.${b.status}`)}</Badge>
                    {!b.over && (b.status === "requested" || b.status === "approved") ? (
                      <CancelMyBookingButton bookingId={b.id} />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
