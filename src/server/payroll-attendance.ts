import { authorizeBranchRead, SerametHttpError, type ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { D1Database } from "@/server/database/d1";

/** One employee's month as payroll needs it, from the Employees register and real clock-ins. */
export type PayrollAttendanceRow = {
  id: string;
  name: string;
  employeeCode: string | null;
  jobTitle: string | null;
  /** True when they left during the month; they still appear for that month. */
  left: boolean;
  daysWorked: number;
  workedMinutes: number;
  lateMinutes: number;
  /** Shifts still open, so their hours are not counted yet. */
  openShifts: number;
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthRange(month: string) {
  const [year, value] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export async function payrollAttendance(
  db: D1Database,
  actor: ServerActor,
  branchId: string,
  month: string,
): Promise<{ month: string; employees: PayrollAttendanceRow[] }> {
  if (!actor.permissions.includes(permissions.payrollManage))
    throw new SerametHttpError(403, "Payroll permission is required");
  if (!MONTH.test(month)) throw new SerametHttpError(400, "Choose a month like 2026-11");
  authorizeBranchRead(actor, actor.tenantId, branchId);
  const branch = await db
    .prepare("SELECT id FROM branches WHERE tenant_id=? AND id=? AND active=1")
    .bind(actor.tenantId, branchId)
    .first<{ id: string }>();
  if (!branch) throw new SerametHttpError(404, "Active branch not found");
  const { from, to } = monthRange(month);
  // Everyone whose primary branch this is: current staff, and anyone who left this month.
  const staff = await db
    .prepare(
      `SELECT u.id,u.name,u.employee_code,u.job_title,u.employment_status
       FROM users u JOIN user_primary_branches pb
         ON pb.tenant_id=u.tenant_id AND pb.user_id=u.id AND pb.branch_id=?
       WHERE u.tenant_id=? AND (
         (u.active=1 AND u.employment_status='ACTIVE')
         OR (u.employment_status='TERMINATED' AND u.effective_until>=?)
       )
       ORDER BY u.name LIMIT 500`,
    )
    .bind(branchId, actor.tenantId, from)
    .all<{
      id: string;
      name: string;
      employee_code: string | null;
      job_title: string | null;
      employment_status: string;
    }>();
  const sessions = await db
    .prepare(
      `SELECT user_id,clock_in_at,clock_out_at,minutes_late FROM employee_attendance_sessions
       WHERE tenant_id=? AND branch_id=? AND business_date>=? AND business_date<=?`,
    )
    .bind(actor.tenantId, branchId, from, to)
    .all<{
      user_id: string;
      clock_in_at: string;
      clock_out_at: string | null;
      minutes_late: number | null;
    }>();
  const totals = new Map<string, { days: number; worked: number; late: number; open: number }>();
  for (const row of sessions.results ?? []) {
    const total = totals.get(row.user_id) ?? { days: 0, worked: 0, late: 0, open: 0 };
    total.days += 1;
    total.late += Math.max(0, Number(row.minutes_late ?? 0));
    if (row.clock_out_at)
      total.worked += Math.max(
        0,
        Math.floor((Date.parse(row.clock_out_at) - Date.parse(row.clock_in_at)) / 60_000),
      );
    else total.open += 1;
    totals.set(row.user_id, total);
  }
  return {
    month,
    employees: (staff.results ?? []).map((employee) => {
      const total = totals.get(employee.id) ?? { days: 0, worked: 0, late: 0, open: 0 };
      return {
        id: employee.id,
        name: employee.name,
        employeeCode: employee.employee_code,
        jobTitle: employee.job_title,
        left: employee.employment_status === "TERMINATED",
        daysWorked: total.days,
        workedMinutes: total.worked,
        lateMinutes: total.late,
        openShifts: total.open,
      };
    }),
  };
}
