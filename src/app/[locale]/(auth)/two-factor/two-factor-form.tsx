"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Link, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

/** The 6-digit code of the authenticator app, or one of the backup codes. */
export function TwoFactorForm({ next }: { next: string }) {
  const t = useTranslations("auth.twoFactor");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const value = code.replace(/\s+/g, "");
    const { error: authError } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code: value, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code: value, trustDevice });
    setPending(false);
    if (authError) {
      setError(
        authError.status === 429
          ? tErrors("tooManyRequests")
          : authError.status === 401 && !authError.code?.includes("CODE")
            ? t("expired")
            : t("invalid"),
      );
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("title")}</h1>
        </CardTitle>
        <CardDescription>{backup ? t("backupDescription") : t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <FormAlert message={error} />
            <Field>
              <FieldLabel htmlFor="two-factor-code">
                {backup ? t("backupCode") : t("code")}
              </FieldLabel>
              <Input
                id="two-factor-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode={backup ? "text" : "numeric"}
                autoComplete="one-time-code"
                dir="ltr"
                autoFocus
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={trustDevice}
                onCheckedChange={(checked) => setTrustDevice(checked === true)}
              />
              {t("trustDevice")}
            </label>
            <Button type="submit" disabled={pending || code.trim() === ""}>
              {t("submit")}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex flex-wrap justify-between gap-2 text-sm">
        <button
          type="button"
          className="text-muted-foreground hover:underline"
          onClick={() => {
            setBackup(!backup);
            setCode("");
            setError(null);
          }}
        >
          {backup ? t("useApp") : t("useBackup")}
        </button>
        <Link href="/sign-in" className="text-muted-foreground hover:underline">
          {t("back")}
        </Link>
      </CardFooter>
    </Card>
  );
}
