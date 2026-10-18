import { afterEach, beforeEach, expect, it } from "vitest";
import { createEmptyTransactionState, TransactionEngine } from "@/lib/transaction-engine";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";

beforeEach(() =>
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState())),
);
afterEach(() => setConfigurationRepositoryForTests());
it("persists canonical rider branch identity and deduplicates name/id branch aliases", () => {
  const state = createEmptyTransactionState(DEMO_TENANT_ID);
  const saved = TransactionEngine.addRider(
    state,
    { name: "New rider", branch: DEMO_WESTLANDS_BRANCH_ID, shift: "18:00-02:00" },
    "Manager",
  );
  expect(saved.employees).toHaveLength(1);
  expect(saved.employees[0]).toMatchObject({
    name: "New rider",
    role: "Rider",
    branchId: DEMO_WESTLANDS_BRANCH_ID,
    branch: "Westlands",
    shift: "18:00-02:00",
  });
  expect(
    TransactionEngine.addRider(
      saved,
      { name: "NEW RIDER", branch: "Westlands", shift: "18:00-02:00" },
      "Manager",
    ),
  ).toEqual(saved);
  expect(state.employees).toHaveLength(0);
});
it("rejects invalid rider input without changing the roster", () => {
  const state = createEmptyTransactionState(DEMO_TENANT_ID);
  for (const changes of [{ name: " " }, { shift: "25:00-10:00" }, { branch: "unassigned" }]) {
    expect(() =>
      TransactionEngine.addRider(
        state,
        { name: "Rider", branch: DEMO_WESTLANDS_BRANCH_ID, shift: "08:00-16:00", ...changes },
        "Manager",
      ),
    ).toThrow();
  }
  expect(state.employees).toHaveLength(0);
});
