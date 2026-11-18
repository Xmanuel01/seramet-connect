import { useEffect, useId, useState } from "react";
import { Btn } from "@/components/app/ui";
import { cn } from "@/lib/utils";
import {
  accessAreas,
  areaLevelId,
  changedPermissions,
  CUSTOM_ACCESS,
  NO_ACCESS,
  permissionLabel,
  withAreaLevel,
  withPermission,
  withTemplate,
  type AccessArea,
} from "@/platform/access-areas";
import { staffRolePresets } from "@/platform/staff-role-presets";

export type RoleAccessSaveResult = { ok: boolean; message: string };

/**
 * What a role can do, one choice per area of the business. Each choice stands for a fixed set
 * of permissions; the Advanced list under an area switches single permissions. Nothing is sent
 * until Save, and permissions this screen does not show are passed through untouched.
 */
export function RoleAccessEditor({
  roleName,
  permissions,
  grantable,
  readOnly,
  onSave,
}: {
  roleName: string;
  /** The role's saved permissions. */
  permissions: readonly string[];
  /** Permissions the signed-in person may give or take away; "all" when there is no limit. */
  grantable: readonly string[] | "all";
  readOnly: boolean;
  onSave: (next: string[]) => Promise<RoleAccessSaveResult>;
}) {
  const formId = useId();
  const savedKey = permissions.join("\n");
  const [draft, setDraft] = useState<string[]>(() => [...permissions]);
  const [template, setTemplate] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<RoleAccessSaveResult | null>(null);

  // Start again from the saved permissions whenever they change (after a save, or elsewhere).
  useEffect(() => {
    setDraft(savedKey ? savedKey.split("\n") : []);
  }, [savedKey]);

  const locked = readOnly || saving;
  const mayChange = (codes: readonly string[]) =>
    grantable === "all" || codes.every((code) => grantable.includes(code));
  const changedAreas = accessAreas.filter((area) =>
    changedPermissions(permissions, draft).some((code) => area.codes.includes(code)),
  );
  const dirty = changedPermissions(permissions, draft).length > 0;
  const limited = grantable !== "all" && accessAreas.some((area) => !mayChange(area.codes));

  const update = (next: string[]) => {
    setDraft(next);
    setStatus(null);
  };

  const save = async () => {
    if (!dirty || locked) return;
    setSaving(true);
    setStatus(null);
    try {
      setStatus(await onSave(draft));
    } finally {
      setSaving(false);
    }
  };

  const templatePermissions = template ? staffRolePresets[template]?.permissions : undefined;
  const templateAllowed =
    !!templatePermissions &&
    mayChange(changedPermissions(permissions, withTemplate(permissions, templatePermissions)));

  return (
    <div className="grid gap-3">
      <div className="rounded-lg border border-border p-3">
        <div className="text-[13px] font-bold">What {roleName} can do</div>
        <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
          Pick one level for each part of the business. Nothing changes until you save.
        </p>
        {!readOnly && (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label
              htmlFor={`${formId}-template`}
              className="text-[12px] font-semibold text-muted-foreground"
            >
              Start from a ready-made role
            </label>
            <select
              id={`${formId}-template`}
              value={template}
              disabled={locked}
              onChange={(event) => setTemplate(event.target.value)}
              className="h-9 min-w-0 rounded-md border border-border bg-card px-3 text-[13px] sm:min-w-[180px]"
            >
              <option value="">Choose…</option>
              {Object.entries(staffRolePresets).map(([id, preset]) => (
                <option key={id} value={id}>
                  {preset.label}
                </option>
              ))}
            </select>
            <Btn
              disabled={locked || !templateAllowed}
              onClick={() => {
                if (templatePermissions) update(withTemplate(draft, templatePermissions));
              }}
            >
              Fill in
            </Btn>
          </div>
        )}
        {limited && !readOnly && (
          <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
            Some choices are greyed out: you can only give or remove access that you have yourself.
          </p>
        )}
      </div>

      {accessAreas.map((area) => (
        <AreaAccess
          key={area.id}
          area={area}
          name={`${formId}-${area.id}`}
          saved={permissions}
          draft={draft}
          locked={locked}
          mayChange={mayChange}
          onChange={update}
        />
      ))}

      <div
        className={cn(
          "flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between",
          dirty && "sticky bottom-2 z-10 border-primary shadow-card",
        )}
      >
        <p role="status" className="min-w-0 text-[12px] leading-5">
          {dirty ? (
            <>
              <span className="font-semibold">Not saved yet: </span>
              {changedAreas.length
                ? changedAreas.map((area) => area.label).join(", ")
                : "other permissions"}
            </>
          ) : status ? (
            <span className={status.ok ? "text-success" : "text-danger"}>{status.message}</span>
          ) : (
            <span className="text-muted-foreground">No changes to save.</span>
          )}
          {dirty && status && !status.ok && (
            <span className="block text-danger">{status.message}</span>
          )}
        </p>
        <div className="flex shrink-0 gap-2">
          <Btn disabled={!dirty || locked} onClick={() => update([...permissions])}>
            Undo changes
          </Btn>
          <Btn variant="primary" disabled={!dirty || locked} onClick={() => void save()}>
            {saving ? "Saving..." : "Save changes"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function AreaAccess({
  area,
  name,
  saved,
  draft,
  locked,
  mayChange,
  onChange,
}: {
  area: AccessArea;
  name: string;
  saved: readonly string[];
  draft: string[];
  locked: boolean;
  mayChange: (codes: readonly string[]) => boolean;
  onChange: (next: string[]) => void;
}) {
  const current = areaLevelId(area, draft);
  const currentLevel = area.levels.find((level) => level.id === current);
  const held = area.codes.filter((code) => draft.includes(code));
  const choices = [
    { id: NO_ACCESS, label: "No access" },
    ...area.levels.map((level) => ({ id: level.id, label: level.label })),
  ];
  const description =
    current === NO_ACCESS
      ? "Cannot use this part of Seramet."
      : current === CUSTOM_ACCESS
        ? "A mix picked one by one. Open Advanced to see it, or choose a level to replace it."
        : currentLevel?.description;

  return (
    <fieldset className="min-w-0 rounded-lg border border-border p-3">
      <legend className="sr-only">{area.label}</legend>
      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="text-[13px] font-bold" aria-hidden="true">
            {area.label}
          </div>
          <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{area.summary}</p>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1.5">
            {choices.map((choice) => {
              const checked = current === choice.id;
              // The server compares with what is saved, so that is what decides if a choice is allowed.
              const allowed = mayChange(
                changedPermissions(saved, withAreaLevel(saved, area, choice.id)),
              );
              return (
                <LevelChoice
                  key={choice.id}
                  name={name}
                  label={choice.label}
                  ariaLabel={`${area.label}: ${choice.label}`}
                  checked={checked}
                  disabled={locked || (!checked && !allowed)}
                  onSelect={() => onChange(withAreaLevel(draft, area, choice.id))}
                />
              );
            })}
            {current === CUSTOM_ACCESS && (
              <LevelChoice
                name={name}
                label="Custom"
                ariaLabel={`${area.label}: Custom`}
                checked
                disabled={locked}
              />
            )}
          </div>
          <p className="mt-2 text-[12px] leading-5" data-area-description={area.id}>
            {description}
          </p>
          {area.note && current !== NO_ACCESS && (
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{area.note}</p>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-[12px] font-semibold text-muted-foreground hover:text-foreground">
              Advanced: pick one by one ({held.length} of {area.codes.length} on)
            </summary>
            <div className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
              {area.codes.map((code) => (
                <label key={code} className="flex min-h-8 items-start gap-2 text-[12px] leading-5">
                  <input
                    type="checkbox"
                    checked={draft.includes(code)}
                    disabled={locked || !mayChange([code])}
                    onChange={(event) =>
                      onChange(withPermission(draft, code, event.target.checked))
                    }
                    className="mt-1 h-3.5 w-3.5 shrink-0 accent-primary"
                  />
                  <span>{permissionLabel(code)}</span>
                </label>
              ))}
            </div>
          </details>
        </div>
      </div>
    </fieldset>
  );
}

function LevelChoice({
  name,
  label,
  ariaLabel,
  checked,
  disabled,
  onSelect,
}: {
  name: string;
  label: string;
  ariaLabel: string;
  checked: boolean;
  disabled: boolean;
  onSelect?: () => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex min-h-9 items-center rounded-md border px-3 text-[12px] font-semibold transition-colors focus-within:ring-2 focus-within:ring-primary/40",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card hover:bg-secondary",
        disabled
          ? checked
            ? "cursor-default"
            : "cursor-not-allowed opacity-50"
          : "cursor-pointer",
      )}
    >
      <input
        type="radio"
        name={name}
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={() => onSelect?.()}
        className="sr-only"
      />
      {label}
    </label>
  );
}
