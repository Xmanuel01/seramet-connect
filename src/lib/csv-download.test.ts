import { expect, it } from "vitest";
import { toCsv } from "./csv-download";

it("quotes cells, escapes quotes and neutralises spreadsheet formulas", () => {
  expect(
    toCsv([
      ["Branch", "Sales"],
      ['Main "A"', 1200],
      ["=HYPERLINK(1)", -5],
    ]),
  ).toBe('"Branch","Sales"\n"Main ""A""","1200"\n"\'=HYPERLINK(1)","-5"');
});
