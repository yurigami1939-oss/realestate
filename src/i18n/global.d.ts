import type messages from "../../messages/fr.json";

import type { Locale } from "./locales";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
