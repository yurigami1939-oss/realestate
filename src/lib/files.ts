/**
 * Uploaded files (CLAUDE.md §5 Files), isomorphic: the upload form and the server share these rules.
 * The server never trusts the browser's MIME type: it sniffs the first bytes.
 */

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const fileFormats = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

export type FileContentType = keyof typeof fileFormats;

/** What an upload is for: decides the accepted formats and which service stores it. */
export const uploadPurposes = {
  "unit.floor_plan": {
    accept: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
    maxBytes: MAX_UPLOAD_BYTES,
  },
  /** Signed scan of a reservation contract. */
  "reservation.contract": {
    accept: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
    maxBytes: MAX_UPLOAD_BYTES,
  },
  /** Signed scan of the VSP deed. */
  "reservation.deed": {
    accept: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
    maxBytes: MAX_UPLOAD_BYTES,
  },
  /** A buyer's document scan; `variant` = the document kind. */
  "buyer.document": {
    accept: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
    maxBytes: MAX_UPLOAD_BYTES,
  },
} as const satisfies Record<string, { accept: readonly FileContentType[]; maxBytes: number }>;

export type UploadPurpose = keyof typeof uploadPurposes;

export const uploadPurposeNames = Object.keys(uploadPurposes) as [
  UploadPurpose,
  ...UploadPurpose[],
];

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** Content type from the file's magic bytes, or null when it is not a supported format. */
export function sniffContentType(bytes: Uint8Array): FileContentType | null {
  if (startsWith(bytes, ascii("%PDF-"))) return "application/pdf";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  return null;
}

export const isImage = (contentType: string) => contentType.startsWith("image/");

/**
 * Display name kept from the upload: no path, no control characters, at most 200 characters,
 * extension preserved when trimming.
 */
export function cleanFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (base === "" || base === "." || base === "..") return "file";
  if (base.length <= 200) return base;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 && base.length - dot <= 10 ? base.slice(dot) : "";
  return base.slice(0, 200 - ext.length) + ext;
}

/** `Content-Disposition` value with an ASCII fallback and the UTF-8 name (RFC 6266 / 5987). */
export function contentDisposition(type: "inline" | "attachment", fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** "1,5 Mo" / "1.5 ميغابايت", Latin digits in both locales. */
export function formatFileSize(bytes: number, locale: "fr" | "ar"): string {
  const [value, unit] =
    bytes >= 1024 * 1024
      ? [bytes / (1024 * 1024), "megabyte"]
      : bytes >= 1024
        ? [bytes / 1024, "kilobyte"]
        : [bytes, "byte"];
  return new Intl.NumberFormat(locale === "ar" ? "ar-u-nu-latn" : "fr", {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value);
}
