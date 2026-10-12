"use client";

import { ErrorState } from "@/components/app-shell/error-state";

/** This area's error boundary (CLAUDE.md §14 item 11). */
export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorState {...props} />;
}
