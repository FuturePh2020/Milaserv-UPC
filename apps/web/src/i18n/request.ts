import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { LOCALES } from '@milaserv/contracts';
import type { Locale } from '@milaserv/contracts';

export const LOCALE_COOKIE = 'milaserv.locale';
const DEFAULT_LOCALE = (process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'ar') as Locale;

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value as Locale | undefined;
  const locale =
    cookieLocale && (LOCALES as readonly string[]).includes(cookieLocale)
      ? cookieLocale
      : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
