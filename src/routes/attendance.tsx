import { createFileRoute } from "@tanstack/react-router";
import { Attendance } from "@/components/app/AttendancePage";

export const Route = createFileRoute("/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance - Seramet" },
      {
        name: "description",
        content: "Secure, location-verified employee clock-in and clock-out.",
      },
    ],
  }),
  component: Attendance,
});
