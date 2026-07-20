import { buildCsv } from "./report-export.util";

describe("buildCsv", () => {
  const columns = [
    { header: "Name", key: "name" },
    { header: "Notes", key: "notes" },
  ];

  it("renders a header row followed by data rows", () => {
    const csv = buildCsv(columns, [{ name: "Ahmed", notes: "ok" }]);
    expect(csv).toBe("Name,Notes\nAhmed,ok");
  });

  it("quotes and escapes fields containing commas, quotes, or newlines", () => {
    const csv = buildCsv(columns, [{ name: "Doe, John", notes: 'Said "hello"\nagain' }]);
    expect(csv).toBe('Name,Notes\n"Doe, John","Said ""hello""\nagain"');
  });

  it("renders missing values as empty strings", () => {
    const csv = buildCsv(columns, [{ name: "Ahmed" }]);
    expect(csv).toBe("Name,Notes\nAhmed,");
  });
});
