"use client";

import { ShieldCheck, ShieldOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { renderSVG } from "uqr";

import { FormAlert } from "@/components/forms/form-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

type Setup = { totpURI: string; backupCodes: string[] };

/** The secret written in the authenticator link, for typing it by hand. */
const secretOf = (uri: string) => new URL(uri).searchParams.get("secret") ?? "";

/**
 * Two-factor authentication of the member's own account: switched on with the password, the
 * authenticator app's QR code (or its key) and the backup codes, confirmed by a first code;
 * switched off with the password.
 */
export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  const t = useTranslations("security");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState<"enable" | "disable" | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(null);
    setPassword("");
    setCode("");
    setSetup(null);
    setError(null);
  };

  async function start() {
    setPending(true);
    setError(null);
    const { data, error: authError } = await authClient.twoFactor.enable({
      password,
      method: "totp",
    });
    setPending(false);
    if (authError || data?.method !== "totp") return setError(t("wrongPassword"));
    setSetup({ totpURI: data.totpURI, backupCodes: data.backupCodes });
  }

  async function confirm() {
    setPending(true);
    setError(null);
    const { error: authError } = await authClient.twoFactor.verifyTotp({
      code: code.replace(/\s+/g, ""),
    });
    setPending(false);
    if (authError) return setError(t("invalidCode"));
    toast.success(t("enabled"));
    close();
    router.refresh();
  }

  async function disable() {
    setPending(true);
    setError(null);
    const { error: authError } = await authClient.twoFactor.disable({ password });
    setPending(false);
    if (authError) return setError(t("wrongPassword"));
    toast.success(t("disabled"));
    close();
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{t("twoFactor")}</CardTitle>
        <Badge variant="outline" className={enabled ? "text-emerald-800" : undefined}>
          {enabled ? t("on") : t("off")}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t("explanation")}</p>
        {enabled ? (
          <Button variant="outline" onClick={() => setOpen("disable")}>
            <ShieldOff data-icon="inline-start" />
            {t("disable")}
          </Button>
        ) : (
          <Button onClick={() => setOpen("enable")}>
            <ShieldCheck data-icon="inline-start" />
            {t("enable")}
          </Button>
        )}
      </CardContent>

      <Dialog open={open !== null} onOpenChange={(next) => (next ? null : close())}>
        <DialogContent
          closeLabel={tc("close")}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>{open === "disable" ? t("disableTitle") : t("enableTitle")}</DialogTitle>
            <DialogDescription>
              {open === "disable"
                ? t("disableDescription")
                : setup
                  ? t("scan")
                  : t("enableDescription")}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <FormAlert message={error} />
            {setup ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URI */}
                <img
                  src={`data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(setup.totpURI))}`}
                  alt={t("qrAlt")}
                  className="mx-auto size-48"
                  data-testid="two-factor-qr"
                />
                <p className="text-center text-xs text-muted-foreground">
                  {t("secret")}{" "}
                  <code dir="ltr" className="font-mono break-all" data-testid="two-factor-secret">
                    {secretOf(setup.totpURI)}
                  </code>
                </p>
                <div className="space-y-1">
                  <p className="font-medium">{t("backupCodes")}</p>
                  <p className="text-xs text-muted-foreground">{t("backupHint")}</p>
                  <ul
                    className="grid grid-cols-2 gap-1 font-mono text-sm"
                    dir="ltr"
                    data-testid="two-factor-backup"
                  >
                    {setup.backupCodes.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
                <Field>
                  <FieldLabel htmlFor="two-factor-confirm">{t("code")}</FieldLabel>
                  <Input
                    id="two-factor-confirm"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    dir="ltr"
                  />
                </Field>
              </>
            ) : (
              <Field>
                <FieldLabel htmlFor="two-factor-password">{t("password")}</FieldLabel>
                <Input
                  id="two-factor-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  dir="ltr"
                />
              </Field>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              {tc("cancel")}
            </Button>
            {open === "disable" ? (
              <Button
                variant="destructive"
                disabled={pending || password === ""}
                onClick={() => void disable()}
              >
                {t("disable")}
              </Button>
            ) : setup ? (
              <Button disabled={pending || code.trim() === ""} onClick={() => void confirm()}>
                {t("confirm")}
              </Button>
            ) : (
              <Button disabled={pending || password === ""} onClick={() => void start()}>
                {t("continue")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
