import { getRequestConfig } from "next-intl/server";

import { APP_TIME_ZONE } from "@/lib/dates";

import { defaultLocale, isLocale } from "./locales";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isLocale(requested) ? requested : defaultLocale;

  return {
    locale,
    timeZone: APP_TIME_ZONE,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
