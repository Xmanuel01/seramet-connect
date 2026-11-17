import { useMemo, useState } from "react";
import { ChevronDown, ShieldAlert } from "lucide-react";
import { Btn } from "@/components/app/ui";
import {
  accessLevelLabels,
  accessSections,
  areaLevel,
  areaLevels,
  permissionChanges,
  roleAccessSummary,
  simpleEditorPermissions,
  withAreaLevel,
  withRiskyAction,
  type AccessArea,
  type AccessLevel,
} from "@/platform/role-access-catalogue";
import { roleTemplates } from "@/platform/role-templates";
import type { PermissionCode } from "@/platform/types";

/**
 * One choice per area (No access, View, Use, Manage) and a switch per risky action, saved as one
 * change. It builds the same permission list the server already checks; nobody can grant or
 * remove access they do not hold themselves.
 */
export function RoleAccessEditor({
  role,
  editorPermissions,
  editorCanDelegateAll,
  showHeadOffice,
  disabled,
  saving,
  onSave,
}: {
  role: { id: string; name: string; permissions: string[] };
  editorPermissions: string[];
  /** Head-office access managers may change any permission. */
  editorCanDelegateAll: boolean;
  showHeadOffice: boolean;
  disabled: boolean;
  saving: boolean;
  onSave: (permissions: string[], reason: string) => Promise<boolean>;
}) {
  const saved = role.permissions as PermissionCode[];
  const [draft, setDraft] = useState<PermissionCode[]>(saved);
  const [template, setTemplate] = useState("");
  const [message, setMessage] = useState("");
  const held = useMemo(() => new Set(draft), [draft]);
  const changes = permissionChanges(saved, draft);
  const pending = changes.added.length + changes.removed.length;
  const summary = roleAccessSummary(draft);
  const mine = useMemo(() => new Set(editorPermissions), [editorPermissions]);
  // A change is allowed only when the editor holds every permission it adds or removes.
  const allowed = (next: PermissionCode[]) => {
    if (editorCanDelegateAll) return true;
    const step = permissionChanges(draft, next);
    return [...step.added, ...step.removed].every((code) => mine.has(code));
  };
  const change = (next: PermissionCode[]) => {
    setMessage("");
    setDraft([...new Set(next)]);
  };
  const sections = accessSections.filter((section) => showHeadOffice || !section.headOffice);

  return (
    <div className="grid gap-3">
      <div className="rounded-lg border border-border p-3">
        <div className="text-[13px] font-bold">What {role.name} can do</div>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {summary.can.length ? summary.can.join(", ") : "Nothing yet."}
          {summary.risky.length ? ` Also allowed to: ${summary.risky.join(", ")}.` : ""}
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="grid min-w-0 flex-1 gap-1 text-[12px] font-semibold">
            Start from a template
            <select
              value={template}
              disabled={disabled || saving}
              onChange={(event) => setTemplate(event.target.value)}
              className="h-9 min-w-0 rounded-md border border-border bg-card px-3 font-normal"
            >
              <option value="">Choose a template…</option>
              {roleTemplates.map((row) => (
                <option key={row.key} value={row.key}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          <Btn
            disabled={disabled || saving || !template}
            onClick={() => {
              const chosen = roleTemplates.find((row) => row.key === template);
              if (!chosen) return;
              const next = [
                ...draft.filter((code) => !simpleEditorPermissions.has(code)),
                ...chosen.permissions,
              ];
              if (!allowed(next)) {
                setMessage(
                  `The ${chosen.label} template includes access you don't have yourself, so you can't give it.`,
                );
                return;
              }
              change(next);
              setMessage(`${chosen.label} template filled in. Review it, then save.`);
            }}
          >
            Use template
          </Btn>
        </div>
      </div>

      {sections.map((section) => {
        const granted = section.areas.filter((area) => areaLevel(area, held) !== "NONE").length;
        return (
          <details key={section.key} className="group rounded-lg border border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">{section.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {granted
                    ? section.areas
                        .map((area) => ({ area, level: areaLevel(area, held) }))
                        .filter(({ level }) => level !== "NONE")
                        .map(
                          ({ area, level }) =>
                            `${area.label}: ${level === "CUSTOM" ? "Custom" : accessLevelLabels[level]}`,
                        )
                        .join(" · ")
                    : "No access"}
                </span>
              </span>
              <ChevronDown
                size={16}
                aria-hidden
                className="shrink-0 transition-transform group-open:rotate-180"
              />
            </summary>
            <div className="grid gap-3 border-t border-border p-3">
              {section.areas.map((area) => (
                <AreaRow
                  key={area.key}
                  area={area}
                  level={areaLevel(area, held)}
                  disabled={disabled || saving}
                  isAllowed={(level) => allowed(withAreaLevel(draft, area, level))}
                  onChoose={(level) => change(withAreaLevel(draft, area, level))}
                />
              ))}
              {section.risky?.length ? (
                <div className="grid gap-2 rounded-md bg-warning-soft/60 p-2.5">
                  <div className="flex items-center gap-1.5 text-[12px] font-bold">
                    <ShieldAlert size={14} aria-hidden /> Risky actions
                  </div>
                  {section.risky.map((action) => {
                    const on = action.permissions.every((code) => held.has(code));
                    const partial = !on && action.permissions.some((code) => held.has(code));
                    const next = withRiskyAction(draft, action, !on);
                    return (
                      <label key={action.key} className="flex items-center gap-2 text-[12px]">
                        <input
                          type="checkbox"
                          role="switch"
                          checked={on}
                          aria-checked={on}
                          disabled={disabled || saving || !allowed(next)}
                          onChange={() => change(next)}
                          className="h-4 w-4 shrink-0 accent-primary"
                        />
                        <span>
                          {action.label}
                          {partial ? " (partly allowed)" : ""}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </details>
        );
      })}

      {message && (
        <p role="status" className="text-[12px] text-muted-foreground">
          {message}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-[12px] text-muted-foreground">
          {pending
            ? `${pending} change${pending === 1 ? "" : "s"} not saved`
            : "No unsaved changes"}
        </span>
        <Btn
          disabled={!pending || saving}
          onClick={() => {
            setDraft(saved);
            setMessage("");
          }}
        >
          Discard
        </Btn>
        <Btn
          variant="primary"
          disabled={!pending || saving || disabled}
          onClick={async () => {
            if (await onSave(draft, `Role access updated for ${role.name}`)) setMessage("Saved.");
          }}
        >
          {saving ? "Saving..." : "Save changes"}
        </Btn>
      </div>
    </div>
  );
}

function AreaRow({
  area,
  level,
  disabled,
  isAllowed,
  onChoose,
}: {
  area: AccessArea;
  level: AccessLevel | "CUSTOM";
  disabled: boolean;
  isAllowed: (level: AccessLevel) => boolean;
  onChoose: (level: AccessLevel) => void;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="text-[12px] font-semibold">
          {area.label}
          {level === "CUSTOM" && (
            <span className="ml-2 rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-bold text-warning">
              Custom
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">{area.hint}</div>
      </div>
      <div
        role="radiogroup"
        aria-label={area.label}
        className="inline-flex w-fit flex-wrap overflow-hidden rounded-md border border-border"
      >
        {areaLevels(area).map((option) => {
          const blocked = option !== level && !isAllowed(option);
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === level}
              disabled={disabled || blocked}
              title={
                blocked ? "You can't give or remove access you don't have yourself" : undefined
              }
              onClick={() => onChoose(option)}
              className={`h-8 border-r border-border px-2.5 text-[12px] font-semibold last:border-r-0 disabled:opacity-50 ${
                option === level
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-foreground hover:bg-secondary"
              }`}
            >
              {accessLevelLabels[option]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
