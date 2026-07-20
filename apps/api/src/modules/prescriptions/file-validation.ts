/**
 * Prescription upload validation (CR-001 design spec §9). Deliberately
 * does not trust the client-declared Content-Type — every check that
 * matters is against the actual bytes. A full malware/AV scan is a
 * pluggable hook for later (design spec §12.3), not implemented here.
 */

type MagicByteCheck = (buf: Buffer) => boolean;

const MAGIC_BYTES: Record<string, MagicByteCheck> = {
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'application/pdf': (b) => b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/webp': (b) =>
    b.length >= 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
};

export function detectMimeFromMagicBytes(buf: Buffer): string | null {
  for (const [mime, check] of Object.entries(MAGIC_BYTES)) {
    if (check(buf)) return mime;
  }
  return null;
}

export type FileValidationResult =
  { ok: true; detectedMime: string } | { ok: false; reason: string };

export function validatePrescriptionFile(params: {
  buffer: Buffer;
  maxSizeMb: number;
  allowedMime: string[];
}): FileValidationResult {
  const { buffer, maxSizeMb, allowedMime } = params;
  if (buffer.length === 0) return { ok: false, reason: 'Empty file' };
  if (buffer.length > maxSizeMb * 1024 * 1024) {
    return { ok: false, reason: `File exceeds the ${maxSizeMb}MB limit` };
  }
  const detectedMime = detectMimeFromMagicBytes(buffer);
  if (!detectedMime) return { ok: false, reason: 'Unrecognized or unsupported file type' };
  if (!allowedMime.includes(detectedMime)) {
    return { ok: false, reason: `File type ${detectedMime} is not allowed` };
  }
  return { ok: true, detectedMime };
}
