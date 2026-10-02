"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import type { AppErrorShape, Result } from "@/lib/result";

import { useTranslateKey } from "./text-field";

type Callbacks<T> = {
  onSuccess?: (data: T) => void;
  /** Return true when the error was handled (e.g. mapped onto form fields); otherwise it is toasted. */
  onError?: (error: AppErrorShape) => boolean | void;
};

/** Runs a Server Action in a transition and surfaces errors as translated toasts. */
export function useAction<I, T>(action: (input: I) => Promise<Result<T>>) {
  const translate = useTranslateKey();
  const [pending, startTransition] = useTransition();

  const run = (input: I, callbacks: Callbacks<T> = {}) =>
    new Promise<void>((resolve) => {
      startTransition(async () => {
        const result = await action(input);
        if (result.ok) callbacks.onSuccess?.(result.data);
        else if (!callbacks.onError?.(result.error))
          toast.error(translate(result.error.messageKey));
        resolve();
      });
    });

  return { run, pending };
}
