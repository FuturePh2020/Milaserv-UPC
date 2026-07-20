/** Pick the display name for the active locale (bilingual masters, §22). */
export function pickName(locale: string, row: { nameAr: string; nameEn: string }): string {
  return locale === 'ar' ? row.nameAr : row.nameEn;
}
