import { enUS, ko, ptBR, type Locale as DateFnsLocale } from 'date-fns/locale';

/**
 * The app-wide UI locale, read once at module init from the same env var
 * next-intl uses (see src/i18n/request.ts). Client and server code that
 * needs a raw BCP-47 tag or a date-fns Locale object (formatDistanceToNow,
 * Intl.NumberFormat, toLocaleDateString, etc.) should read it from here
 * instead of hardcoding 'en-US'.
 */
export const APP_LOCALE = process.env.NEXT_PUBLIC_APP_LOCALE || 'en';

const DATE_FNS_LOCALES: Record<string, DateFnsLocale> = {
  en: enUS,
  'pt-BR': ptBR,
  ko,
};

export const dateFnsLocale: DateFnsLocale = DATE_FNS_LOCALES[APP_LOCALE] ?? enUS;
