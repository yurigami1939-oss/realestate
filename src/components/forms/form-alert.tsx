import { CircleAlert, CircleCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";

/** Form-level message (server error or confirmation). */
export function FormAlert({
  message,
  tone = "error",
}: {
  message: string | null;
  tone?: "error" | "success";
}) {
  if (!message) return null;
  return (
    <Alert
      variant={tone === "error" ? "destructive" : "default"}
      role={tone === "error" ? "alert" : "status"}
    >
      {tone === "error" ? <CircleAlert /> : <CircleCheck />}
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
