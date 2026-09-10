import { createFileRoute } from "@tanstack/react-router";
import { HostStation } from "@/guest/host-station";

export const Route = createFileRoute("/waitlist")({ component: HostStation });
