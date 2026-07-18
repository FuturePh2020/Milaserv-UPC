import { detectMimeFromMagicBytes, validatePrescriptionFile } from './file-validation';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const PDF = Buffer.from('%PDF-1.4\n', 'latin1');
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBP', 'latin1'),
]);
const EXE_DISGUISED_AS_JPEG = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // real magic bytes: MZ (PE executable)

describe('detectMimeFromMagicBytes', () => {
  it('recognizes JPEG', () => {
    expect(detectMimeFromMagicBytes(JPEG)).toBe('image/jpeg');
  });
  it('recognizes PNG', () => {
    expect(detectMimeFromMagicBytes(PNG)).toBe('image/png');
  });
  it('recognizes PDF', () => {
    expect(detectMimeFromMagicBytes(PDF)).toBe('application/pdf');
  });
  it('recognizes WEBP', () => {
    expect(detectMimeFromMagicBytes(WEBP)).toBe('image/webp');
  });
  it('returns null for unrecognized bytes — never trusts a declared type', () => {
    expect(detectMimeFromMagicBytes(EXE_DISGUISED_AS_JPEG)).toBeNull();
  });
  it('returns null for an empty buffer', () => {
    expect(detectMimeFromMagicBytes(Buffer.alloc(0))).toBeNull();
  });
});

describe('validatePrescriptionFile', () => {
  const allowedMime = ['image/jpeg', 'image/png', 'application/pdf'];

  it('accepts a valid JPEG within the size limit', () => {
    const result = validatePrescriptionFile({ buffer: JPEG, maxSizeMb: 15, allowedMime });
    expect(result).toEqual({ ok: true, detectedMime: 'image/jpeg' });
  });

  it('rejects an empty file', () => {
    const result = validatePrescriptionFile({
      buffer: Buffer.alloc(0),
      maxSizeMb: 15,
      allowedMime,
    });
    expect(result).toEqual({ ok: false, reason: 'Empty file' });
  });

  it('rejects a file over the configured size limit', () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]);
    const result = validatePrescriptionFile({ buffer: big, maxSizeMb: 1, allowedMime });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('1MB');
  });

  it('rejects bytes that do not match any known file signature — a renamed .exe is caught by content, not extension', () => {
    const result = validatePrescriptionFile({
      buffer: EXE_DISGUISED_AS_JPEG,
      maxSizeMb: 15,
      allowedMime,
    });
    expect(result).toEqual({ ok: false, reason: 'Unrecognized or unsupported file type' });
  });

  it('rejects a recognized type that is not on the allowlist', () => {
    const result = validatePrescriptionFile({ buffer: WEBP, maxSizeMb: 15, allowedMime });
    expect(result).toEqual({ ok: false, reason: 'File type image/webp is not allowed' });
  });
});
