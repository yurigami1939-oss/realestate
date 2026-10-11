import { SettingsFrame } from "@/components/settings/settings-frame";

/** A page of the settings hub (CLAUDE.md §14, item 7): its navigation beside it. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SettingsFrame>{children}</SettingsFrame>;
}
