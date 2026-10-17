import { createFileRoute } from "@tanstack/react-router";
import { Attendance } from "@/components/app/AttendancePage";

export const Route = createFileRoute("/schedule")({
  head: () => ({ meta: [{ title: "Schedule - Seramet" }] }),
  component: () => <Attendance scheduling />,
});
