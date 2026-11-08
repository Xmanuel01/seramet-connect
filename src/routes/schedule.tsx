import { createFileRoute } from "@tanstack/react-router";
import { Attendance } from "@/components/app/AttendancePage";

export const Route = createFileRoute("/schedule")({
  head: () => ({ meta: [{ title: "Time Tracking - Seramet" }] }),
  component: () => <Attendance scheduling />,
});
