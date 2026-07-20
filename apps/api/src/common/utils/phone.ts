import { parsePhoneNumberFromString } from "libphonenumber-js";

const DEFAULT_REGION = (process.env.PHONE_DEFAULT_REGION as any) || "EG";

/**
 * Normalizes a phone number to E.164 when parseable, otherwise falls back to
 * digits-only (keeping a leading +) so duplicate detection still has a
 * stable key even for malformed input.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = parsePhoneNumberFromString(trimmed, DEFAULT_REGION);
  if (parsed && parsed.isValid()) {
    return parsed.number;
  }

  const digits = trimmed.replace(/[^\d+]/g, "");
  return digits || null;
}

export function isValidPhone(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const parsed = parsePhoneNumberFromString(trimmed, DEFAULT_REGION);
  if (parsed) return parsed.isValid();
  // fallback heuristic: at least 6 digits
  return trimmed.replace(/[^\d]/g, "").length >= 6;
}
