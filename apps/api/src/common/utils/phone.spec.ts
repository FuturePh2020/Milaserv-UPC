import { normalizePhone, isValidPhone } from "./phone";

describe("phone normalization", () => {
  it("normalizes a valid Egyptian mobile number to E.164", () => {
    expect(normalizePhone("01001234567")).toBe("+201001234567");
  });

  it("leaves an already-E.164 number unchanged", () => {
    expect(normalizePhone("+201001234567")).toBe("+201001234567");
  });

  it("treats numbers with different formatting as equivalent for dedupe", () => {
    const a = normalizePhone("010 0123 4567");
    const b = normalizePhone("+20 100 123 4567");
    expect(a).toBe(b);
  });

  it("returns null for empty input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it("flags an obviously invalid phone number", () => {
    expect(isValidPhone("123")).toBe(false);
    expect(isValidPhone("+201001234567")).toBe(true);
  });
});
