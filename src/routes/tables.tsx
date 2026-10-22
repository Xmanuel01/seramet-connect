import { createFileRoute } from "@tanstack/react-router";
import { HostStation } from "@/guest/host-station";

export const Route = createFileRoute("/tables")({
  head: () => ({ meta: [{ title: "Front of House - Tables - Seramet" }] }),
  component: () => <HostStation view="/tables" />,
});
