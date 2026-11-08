import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { SerametHttpError } from "@/lib/seramet-auth";
import { attendanceDuration } from "@/lib/attendance-summary";
import type { attendanceRecords } from "./attendance-reporting";

export async function renderAttendancePdf(
  report: Awaited<ReturnType<typeof attendanceRecords>>,
  branch: string,
  timezone: string,
) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Seramet attendance report");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([842, 595]);
  let y = 0;
  const text = (value: string, x: number, at: number, size = 9, strong = false) => {
    try {
      page.drawText(value, {
        x,
        y: at,
        size,
        font: strong ? bold : font,
        color: rgb(0.08, 0.13, 0.15),
      });
    } catch {
      throw new SerametHttpError(
        422,
        "This report contains characters not supported by the PDF font. Export CSV to retain the original names.",
      );
    }
  };
  const header = () => {
    text("SERAMET | Attendance", 32, 557, 18, true);
    text(`${report.from} to ${report.to} | ${timezone}`, 32, 536);
    text(`Branch: ${branch}`, 32, 520);
    text(
      `Employee: ${report.employeeId ?? "All"} | Status: ${report.status} | Verification: ${report.source}`,
      32,
      504,
    );
    text(
      `Worked: ${attendanceDuration(report.summary?.workedMinutes)} | Over schedule: ${attendanceDuration(report.summary?.overtimeMinutes)} | Unassessed days: ${report.summary?.unassessedDays ?? 0}`,
      32,
      484,
      10,
    );
    text(
      "Schedule comparison only; not a payroll calculation. Open shifts are provisional.",
      32,
      467,
    );
    ["Employee / business date", "Clock in", "Clock out", "Worked", "Late", "Verification"].forEach(
      (label, i) => text(label, [32, 270, 395, 520, 610, 675][i], 440, 9, true),
    );
    y = 416;
  };
  header();
  const local = (at: string | null) =>
    at
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone: timezone,
          dateStyle: "short",
          timeStyle: "short",
          hour12: false,
        }).format(new Date(at))
      : "Open";
  for (const row of report.records) {
    if (y < 55) {
      page = pdf.addPage([842, 595]);
      header();
    }
    // Wrap names to the fixed employee column without clipping identities.
    const lines: string[] = [];
    let line = "";
    for (const char of row.employeeName) {
      try {
        if (font.widthOfTextAtSize(line + char, 9) > 215) {
          lines.push(line);
          line = "";
        }
      } catch {
        throw new SerametHttpError(
          422,
          "Export CSV to retain characters not supported by the PDF font.",
        );
      }
      line += char;
    }
    lines.push(line);
    if (y - (lines.length + 1) * 13 < 32) {
      page = pdf.addPage([842, 595]);
      header();
    }
    lines.forEach((name, index) => text(name, 32, y - index * 13));
    text(row.businessDate, 32, y - lines.length * 13, 8);
    text(local(row.clockInAt), 270, y);
    text(local(row.clockOutAt), 395, y);
    text(row.clockOutAt ? attendanceDuration(row.workedMinutes) : "In progress", 520, y);
    text(row.minutesLate === null ? "--" : `${row.minutesLate} min`, 610, y);
    text(row.clockInSource, 675, y);
    y -= Math.max(38, (lines.length + 1) * 13 + 10);
  }
  if (!report.records.length) text("No attendance records in this period.", 32, y);
  pdf.getPages().forEach((p, i) => {
    page = p;
    text(`Page ${i + 1} of ${pdf.getPageCount()} | Generated ${report.serverNow}`, 32, 22, 8);
  });
  return pdf.save();
}
