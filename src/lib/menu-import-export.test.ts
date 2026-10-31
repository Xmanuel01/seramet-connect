import { describe, expect, it } from "vitest";
import { parseXlsxRows } from "@/lib/menu-import-export";

// Minimal stored (uncompressed) ZIP writer; the reader ignores CRCs.
function zip(files: Record<string, string>) {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let cursor = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out.buffer;
}

const sheetXml = (rows: string, prefix = "") =>
  `<?xml version="1.0"?><${prefix}worksheet xmlns${prefix ? `:${prefix.slice(0, -1)}` : ""}="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><${prefix}sheetData>${rows}</${prefix}sheetData></${prefix}worksheet>`;
const inline = (ref: string, text: string) =>
  `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
const menuRows =
  `<row r="1">${inline("A1", "code")}${inline("B1", "name")}${inline("C1", "category")}${inline("D1", "price")}</row>` +
  `<row r="2">${inline("A2", "M001")}${inline("B2", "Coconut Rice")}${inline("C2", "Sides")}<c r="D2"><v>350</v></c></row>`;

function workbook(
  sheets: Array<{ name: string; rid: string; target: string; xml: string; state?: string }>,
  { relsOrder }: { relsOrder?: string[] } = {},
) {
  const order = relsOrder ?? sheets.map((sheet) => sheet.rid);
  return zip({
    "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map(
        (sheet, index) =>
          `<sheet name="${sheet.name}" sheetId="${index + 1}"${sheet.state ? ` state="${sheet.state}"` : ""} r:id="${sheet.rid}"/>`,
      )
      .join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships>${order
      .map((rid) => sheets.find((sheet) => sheet.rid === rid)!)
      .map((sheet) => `<Relationship Id="${sheet.rid}" Type="worksheet" Target="${sheet.target}"/>`)
      .join("")}</Relationships>`,
    ...Object.fromEntries(
      sheets.map((sheet) => [
        sheet.target.startsWith("/") ? sheet.target.slice(1) : `xl/${sheet.target}`,
        sheet.xml,
      ]),
    ),
  });
}

const expected = [{ code: "M001", name: "Coconut Rice", category: "Sides", price: "350" }];

describe("parseXlsxRows", () => {
  it("reads the first sheet in tab order, not relationship order", async () => {
    const rows = await parseXlsxRows(
      workbook(
        [
          { name: "Menu", rid: "rId1", target: "worksheets/sheet2.xml", xml: sheetXml(menuRows) },
          {
            name: "Notes",
            rid: "rId2",
            target: "worksheets/sheet1.xml",
            xml: sheetXml(`<row r="1">${inline("A1", "Fill in the Menu sheet")}</row>`),
          },
        ],
        { relsOrder: ["rId2", "rId1"] },
      ),
    );
    expect(rows).toEqual(expected);
  });

  it("skips hidden sheets and uses the first visible sheet that has rows", async () => {
    const rows = await parseXlsxRows(
      workbook([
        {
          name: "Lookups",
          rid: "rId1",
          target: "worksheets/sheet1.xml",
          state: "hidden",
          xml: sheetXml(
            `<row r="1">${inline("A1", "station")}</row><row r="2">${inline("A2", "KITCHEN")}</row>`,
          ),
        },
        {
          name: "Cover",
          rid: "rId2",
          target: "worksheets/sheet2.xml",
          xml: sheetXml(`<row r="1">${inline("A1", "code")}</row>`),
        },
        { name: "Menu", rid: "rId3", target: "worksheets/sheet3.xml", xml: sheetXml(menuRows) },
      ]),
    );
    expect(rows).toEqual(expected);
  });

  it("reads namespace-prefixed markup and absolute part names", async () => {
    const prefixed = menuRows
      .replace(/<(\/?)(row|c|v|is|t)\b/g, "<$1x:$2")
      .replace(/<x:c r/g, "<x:c r");
    const rows = await parseXlsxRows(
      workbook([
        {
          name: "Export",
          rid: "rId7",
          target: "/xl/worksheets/data.xml",
          xml: sheetXml(prefixed, "x:"),
        },
      ]),
    );
    expect(rows).toEqual(expected);
  });

  it("keeps values in their columns around empty styled cells", async () => {
    const rows = await parseXlsxRows(
      workbook([
        {
          name: "Menu",
          rid: "rId1",
          target: "worksheets/sheet1.xml",
          xml: sheetXml(
            `<row r="1">${inline("A1", "code")}${inline("B1", "sku")}${inline("C1", "name")}</row>` +
              `<row r="2" spans="1:3"/>` +
              `<row r="3">${inline("A3", "M001")}<c r="B3" s="4"/>${inline("C3", "Coconut Rice")}</row>`,
          ),
        },
      ]),
    );
    expect(rows).toEqual([{ code: "M001", sku: "", name: "Coconut Rice" }]);
  });

  it("joins rich-text runs, drops phonetic hints and decodes character references", async () => {
    const bytes = zip({
      "xl/workbook.xml":
        '<workbook xmlns:r="r"><sheets><sheet name="Menu" sheetId="1" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels":
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="sharedStrings.xml"/></Relationships>',
      "xl/sharedStrings.xml":
        "<sst><si><t>name</t></si><si><r><t>Caf</t></r><r><t>&#233; Latte</t></r><rPh><t>kafe</t></rPh></si></sst>",
      "xl/worksheets/sheet1.xml": sheetXml(
        '<row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row>',
      ),
    });
    expect(await parseXlsxRows(bytes)).toEqual([{ name: "Café Latte" }]);
  });

  it("returns no rows for a workbook with only a header row", async () => {
    const rows = await parseXlsxRows(
      workbook([
        {
          name: "Menu",
          rid: "rId1",
          target: "worksheets/sheet1.xml",
          xml: sheetXml(`<row r="1">${inline("A1", "code")}${inline("B1", "name")}</row>`),
        },
      ]),
    );
    expect(rows).toEqual([]);
  });
});
