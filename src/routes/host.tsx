import { createFileRoute } from "@tanstack/react-router";
import { HostStation } from "@/guest/host-station";

export const Route = createFileRoute("/host")({
  head: () => ({
    meta: [
      { title: "Host Station - Seramet" },
      {
        name: "description",
        content: "Live seating, waitlist, table and guest service operations.",
      },
    ],
  }),
  component: HostStation,
});
