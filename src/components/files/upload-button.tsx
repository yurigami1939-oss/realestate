"use client";

import { Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useTranslateKey } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import { sniffContentType, uploadPurposes, type UploadPurpose } from "@/lib/files";
import type { Result } from "@/lib/result";

/**
 * File picker that posts to the upload Route Handler (`/api/files`).
 * Size and format are pre-checked here for a quick answer; the server checks them again.
 */
export function UploadButton({
  purpose,
  entityId,
  detail,
  label,
  icon,
  onUploaded,
  variant = "outline",
}: {
  purpose: UploadPurpose;
  entityId: string;
  /** Purpose-specific detail sent as `variant` (e.g. the document kind of a buyer scan). */
  detail?: string;
  label: string;
  icon?: React.ReactNode;
  onUploaded?: (data: { fileId: string }) => void;
  variant?: "outline" | "default" | "ghost";
}) {
  const translate = useTranslateKey();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const rules = uploadPurposes[purpose];

  async function upload(file: File) {
    const fail = (messageKey: string) => void toast.error(translate(messageKey));
    if (file.size === 0) return fail("files.errors.empty");
    if (file.size > rules.maxBytes) return fail("files.errors.tooLarge");
    const type = sniffContentType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    if (!type || !(rules.accept as readonly string[]).includes(type)) {
      return fail("files.errors.type");
    }

    setPending(true);
    try {
      const body = new FormData();
      body.set("purpose", purpose);
      body.set("entityId", entityId);
      if (detail) body.set("variant", detail);
      body.set("file", file);
      const response = await fetch("/api/files", { method: "POST", body });
      const result = (await response.json()) as Result<{ fileId: string }>;
      if (result.ok) onUploaded?.(result.data);
      else fail(result.error.messageKey);
    } catch {
      fail("errors.UNEXPECTED");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={rules.accept.join(",")}
        className="hidden"
        data-testid={detail ? `upload-${purpose}-${detail}` : `upload-${purpose}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
      <Button
        type="button"
        variant={variant}
        disabled={pending}
        onClick={() => inputRef.current?.click()}
      >
        {pending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : icon}
        {label}
      </Button>
    </>
  );
}
