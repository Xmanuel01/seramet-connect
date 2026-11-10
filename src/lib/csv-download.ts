/**
 * Builds a CSV document from rows of cells. Every cell is quoted, and a cell that starts
 * with = + - @ is prefixed with ' so spreadsheet apps show it as text, not run it as a
 * formula (CSV injection).
 */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number>>) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell);
          const safe = /^[=+\-@]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text;
          return `"${safe.replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\n");
}

/** Saves rows as a CSV file in the browser. */
export function downloadCsv(filename: string, rows: ReadonlyArray<ReadonlyArray<string | number>>) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
