import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/guest/$restaurant")({
  head: () => ({
    meta: [
      { title: "Order or reserve - Seramet Guest" },
      {
        name: "description",
        content: "View the live restaurant menu, order, reserve and track your visit.",
      },
    ],
  }),
  component: Outlet,
});
