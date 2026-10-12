"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-[1.125rem] text-success" />,
        info: <InfoIcon className="size-[1.125rem] text-info" />,
        warning: <TriangleAlertIcon className="size-[1.125rem] text-warning" />,
        error: <OctagonXIcon className="size-[1.125rem] text-danger" />,
        loading: <Loader2Icon className="size-[1.125rem] animate-spin text-muted-foreground" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "transparent",
          "--border-radius": "calc(var(--radius) * 1.4)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !shadow-raised font-sans",
          title: "font-medium",
          description: "!text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
