import { createFileRoute } from "@tanstack/react-router";
import { Globe2, Instagram, MessageCircle } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/marketing")({
  head: () => ({
    meta: [
      { title: "Website & Channels - Seramet" },
      {
        name: "description",
        content: "Manage restaurant website, social pages and WhatsApp Business operations.",
      },
    ],
  }),
  component: Marketing,
});

const channels = [
  {
    name: "Website",
    icon: Globe2,
    status: "Live",
    detail: "Menu, branch hours, table booking links and online ordering links.",
  },
  {
    name: "Social pages",
    icon: Instagram,
    status: "Scheduled",
    detail: "Instagram, Facebook and TikTok posts for offers, new dishes and events.",
  },
  {
    name: "WhatsApp Business",
    icon: MessageCircle,
    status: "Connected",
    detail: "Catalog, quick replies, customer broadcasts and click-to-chat links.",
  },
];

function Marketing() {
  const { branchLabel } = useAppContext();
  const [activeChannel, setActiveChannel] = useState(channels[0]!.name);
  const selectedChannel = channels.find((channel) => channel.name === activeChannel)!;
  return (
    <AppShell
      title="Website & Channels"
      subtitle={`Marketing operations - ${branchLabel}`}
      actions={
        <>
          <Btn>Preview website</Btn>
          <Btn variant="primary">Publish updates</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Website status" value="Live" />
        <Metric label="Scheduled posts" value={12} />
        <Metric label="WhatsApp chats" value={84} delta={6.2} />
        <Metric label="Menu sync" value="Ready" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {channels.map((channel) => {
          const Icon = channel.icon;
          return (
            <Panel key={channel.name} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <Status>{channel.status}</Status>
              </div>
              <div className="mt-4 text-[15px] font-bold">{channel.name}</div>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                {channel.detail}
              </p>
              <button
                onClick={() => setActiveChannel(channel.name)}
                className="mt-4 rounded-md border border-border px-3 py-2 text-[12px] font-semibold hover:bg-secondary"
              >
                Manage
              </button>
            </Panel>
          );
        })}
      </div>
      <Panel className="mt-4">
        <PanelHead
          title={`Managing ${selectedChannel.name}`}
          sub={selectedChannel.detail}
          right={<Status>{selectedChannel.status}</Status>}
        />
        <div className="grid gap-3 p-4 md:grid-cols-3">
          {["Content", "Approvals", "Publishing"].map((item) => (
            <label
              key={item}
              className="grid gap-1 text-[12px] font-semibold text-muted-foreground"
            >
              {item}
              <input
                className="h-9 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none"
                defaultValue={`${selectedChannel.name} ${item.toLowerCase()}`}
              />
            </label>
          ))}
        </div>
      </Panel>
      <Panel className="mt-4">
        <PanelHead
          title="Approval queue"
          sub="Marketing changes can be prepared by a marketing operator and approved by management"
        />
        <div className="grid gap-2 p-4 md:grid-cols-3">
          {["New Eid buffet hero image", "WhatsApp quick reply update", "Glovo offer banner"].map(
            (item, index) => (
              <div key={item} className="rounded-lg border border-border p-3">
                <div className="text-[13px] font-semibold">{item}</div>
                <div className="mt-2 text-[12px] text-muted-foreground">
                  {index === 0 ? "Needs approval" : "Draft ready"}
                </div>
              </div>
            ),
          )}
        </div>
      </Panel>
    </AppShell>
  );
}
