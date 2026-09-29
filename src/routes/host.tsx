import { createFileRoute } from "@tanstack/react-router";
import { HostStation } from "@/guest/host-station";

export const Route = createFileRoute("/host")({
  head: () => ({
    meta: [
      { title: "Front of House - Seramet" },
      {
        name: "description",
        content: "Unified reservations, seating, waitlist and guest service operations.",
      },
    ],
  }),
  component: HostStation,
});
