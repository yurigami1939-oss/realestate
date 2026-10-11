import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import {
  ArchiveRoomButton,
  BookRoomDialog,
  CancelBookingButton,
  DecideBooking,
  RoomDialog,
} from "@/components/rooms/room-dialogs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toLocale } from "@/i18n/locales";
import { formatDate, todayInAlgiers } from "@/lib/dates";
import { accessOf, can } from "@/lib/permissions";
import type { BookingStatus } from "@/lib/rooms";
import { requirePermission } from "@/server/auth/page-guard";
import { getResidence } from "@/server/residences/queries";
import { listRooms, timeOf } from "@/server/rooms/service";

import { ResidenceNav } from "../_components/residence-nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("rooms");
  return { title: t("title") };
}

const statusClass: Record<BookingStatus, string> = {
  requested: "text-amber-800",
  approved: "text-emerald-800",
  rejected: "text-red-800",
  cancelled: "text-muted-foreground",
};

/**
 * Common rooms of a residence: their rules and the bookings from today on, the requests to
 * confirm first among them.
 */
export default async function ResidenceRoomsPage({
  params,
}: PageProps<"/[locale]/residences/[residenceId]/rooms">) {
  const { locale: raw, residenceId } = await params;
  setRequestLocale(toLocale(raw));
  const ctx = await requirePermission("residence:read");
  const home = await getResidence(ctx, residenceId);
  if (!home) notFound();
  const rooms = await listRooms(ctx, residenceId);
  const editable = can(ctx, "residence:update");
  const t = await getTranslations("rooms");
  const tr = await getTranslations("residences");
  const today = todayInAlgiers();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={home.name}
        description={home.projectName}
        crumbs={[{ label: tr("title"), href: "/residences" }]}
        actions={editable ? <RoomDialog residenceId={residenceId} /> : null}
      />
      <ResidenceNav residenceId={residenceId} current="rooms" roles={accessOf(ctx)} />
      <p className="text-sm text-muted-foreground">{t("description")}</p>

      {rooms.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="space-y-4" data-testid="common-rooms">
          {rooms.map((room) => (
            <Card key={room.id} data-room={room.name}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <CardTitle className="text-base">{room.name}</CardTitle>
                  <div className="text-sm text-muted-foreground">
                    <span dir="ltr">
                      {t("hours", { from: room.opensAt, to: room.closesAt, hours: room.maxHours })}
                    </span>
                    {room.capacity ? ` · ${t("capacity", { count: room.capacity })}` : ""} ·{" "}
                    {room.needsApproval ? t("approval") : t("instant")}
                  </div>
                  {room.description ? (
                    <p className="text-sm whitespace-pre-line">{room.description}</p>
                  ) : null}
                </div>
                {editable ? (
                  <div className="flex items-center gap-1">
                    <BookRoomDialog roomId={room.id} roomName={room.name} today={today} />
                    <RoomDialog
                      residenceId={residenceId}
                      roomId={room.id}
                      values={{
                        name: room.name,
                        description: room.description ?? "",
                        capacity: room.capacity === null ? "" : String(room.capacity),
                        opensAt: room.opensAt,
                        closesAt: room.closesAt,
                        maxHours: String(room.maxHours),
                        needsApproval: room.needsApproval,
                      }}
                    />
                    <ArchiveRoomButton roomId={room.id} />
                  </div>
                ) : null}
              </CardHeader>
              <CardContent>
                <div className="mb-2 text-sm font-medium">{t("bookings")}</div>
                {room.bookings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noBookings")}</p>
                ) : (
                  <ul className="divide-y text-sm" data-testid="room-bookings">
                    {room.bookings.map((b) => (
                      <li
                        key={b.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-2"
                        data-status={b.status}
                      >
                        <div>
                          <div className="font-medium">
                            <span dir="ltr">
                              {t("slot", {
                                day: formatDate(b.startsAt),
                                from: timeOf(b.startsAt),
                                to: timeOf(b.endsAt),
                              })}
                            </span>{" "}
                            · {b.bookedFor}
                          </div>
                          <div className="text-muted-foreground">
                            {b.purpose}
                            {b.guests ? ` · ${b.guests}` : ""}
                            {b.decisionNote ? ` · ${b.decisionNote}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={statusClass[b.status]}>
                            {t(`status.${b.status}`)}
                          </Badge>
                          {editable && b.status === "requested" ? (
                            <DecideBooking bookingId={b.id} />
                          ) : null}
                          {editable && b.status === "approved" ? (
                            <CancelBookingButton bookingId={b.id} />
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
