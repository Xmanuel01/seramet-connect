import { createFileRoute } from "@tanstack/react-router";
import { HostStation } from "@/guest/host-station";

export const Route = createFileRoute("/reservations")({
  head: () => ({
    meta: [
      { title: "Reservations - Seramet" },
      {
        name: "description",
        content: "Authoritative reservations, arrivals and table allocation.",
      },
    ],
  }),
  component: HostStation,
});
