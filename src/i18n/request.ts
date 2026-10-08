import { getRequestConfig } from 'next-intl/server';
import enMessages from '../../messages/en.json';
import { mergeMessages } from './merge-messages';

const SUPPORTED_LOCALES = ['en', 'pt-BR', 'ko'];

export default getRequestConfig(async () => {
  // Read the locale from the environment, defaulting to 'en'
  const locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'en';

  if (locale === 'en' || !SUPPORTED_LOCALES.includes(locale)) {
    return { locale: 'en', messages: enMessages };
  }

  let localeMessages;
  try {
    localeMessages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    // Fallback to English if the dictionary for the requested locale doesn't exist yet
    return { locale: 'en', messages: enMessages };
  }

  // Merge onto the English base so any key the locale dictionary hasn't
  // caught up on yet still renders in English instead of as a raw key path.
  return { locale, messages: mergeMessages(enMessages, localeMessages) };
});
