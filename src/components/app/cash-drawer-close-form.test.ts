import { beforeEach, expect, it, vi } from "vitest";
import type { FormEvent, ReactElement } from "react";
import { CashDrawerCloseForm } from "./CashDrawerCloseForm";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [
      hooks.values[index],
      (value: unknown) => {
        hooks.values[index] = value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
}));

beforeEach(() => {
  hooks.values = [];
  hooks.cursor = 0;
});

function render(onClose: (count: string) => Promise<unknown>) {
  hooks.cursor = 0;
  return CashDrawerCloseForm({ expected: 100.1, currency: "KES", onClose }) as ReactElement<{
    onSubmit: (event: FormEvent) => Promise<void>;
  }>;
}
const submit = (form: ReturnType<typeof render>) =>
  form.props.onSubmit({ preventDefault() {} } as FormEvent);

it("retains the physical count on failed acknowledgement and only reports success after recovery", async () => {
  const close = vi
    .fn()
    .mockRejectedValueOnce(new Error("Server unavailable"))
    .mockResolvedValueOnce({});
  render(close);
  hooks.values[0] = "100.09";
  await submit(render(close));
  expect(close).toHaveBeenCalledWith("100.09");
  expect(hooks.values[0]).toBe("100.09");
  expect(hooks.values[2]).toBe("Server unavailable");
  await submit(render(close));
  expect(hooks.values[2]).toBe("Cash drawer closed.");
});

it("does not submit missing counts or duplicate a pending submission", async () => {
  let acknowledge!: () => void;
  const close = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
  );
  await submit(render(close));
  expect(close).not.toHaveBeenCalled();
  hooks.values[0] = "100.09";
  const pending = submit(render(close));
  await submit(render(close));
  expect(close).toHaveBeenCalledTimes(1);
  expect(hooks.values[2]).toBe("");
  acknowledge();
  await pending;
  expect(hooks.values[2]).toBe("Cash drawer closed.");
});
