import {
  TransactionEngine,
  createEmptyTransactionState,
  type TransactionState,
} from "@/lib/transaction-engine";
import { createDefaultDemoPlatformState, DEMO_TENANT_ID } from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  getConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";

function demoConfiguration() {
  const current = getConfigurationRepository();
  try {
    current.getTenant(DEMO_TENANT_ID);
    return current;
  } catch {
    const repository = new ConfigurationRepository(createDefaultDemoPlatformState());
    setConfigurationRepositoryForTests(repository);
    return repository;
  }
}

/** Test-only operational state. Production and pilot runtime always start empty. */
export function createInitialTransactionState(): TransactionState {
  const configuration = demoConfiguration();
  const branches = configuration.listBranches(DEMO_TENANT_ID);
  const primary = branches[0];
  const secondary = branches.find((branch) => branch.id !== primary?.id) ?? primary;
  if (!primary || !secondary) throw new Error("Demo test configuration requires two branches");

  let state = createEmptyTransactionState(DEMO_TENANT_ID);
  state = TransactionEngine.createOrder(
    state,
    {
      tenantId: DEMO_TENANT_ID,
      branchId: primary.id,
      branch: primary.name,
      table: "T-TEST-01",
      customer: "Test guest",
      channel: "Dine-In",
      cashier: "Test cashier",
      waiter: "Test waiter",
      lines: [
        {
          id: "line-test-001",
          productId: "product-test-001",
          name: "Test item",
          category: "Test category",
          quantity: 1,
          unitPrice: 4200,
          productionStation: "MAIN KITCHEN",
        },
      ],
    },
    "OPEN",
  );
  const primaryOrderId = state.orders[0]!.id;
  state = TransactionEngine.sendToKitchen(state, primaryOrderId, "Test cashier");
  state = TransactionEngine.requestBill(state, primaryOrderId, "Test cashier");
  const paymentMethod = configuration
    .listPaymentMethods(DEMO_TENANT_ID, true)
    .find((method) => method.category !== "CASH");
  state = TransactionEngine.createPaymentIntent(state, state.bills[0]!.id, {
    amount: state.bills[0]!.total,
    method: paymentMethod?.code ?? "TEST_DIGITAL",
    provider: paymentMethod?.displayName ?? "Test payment provider",
    createdBy: "Test cashier",
  }).state;

  state = TransactionEngine.createOrder(
    state,
    {
      tenantId: DEMO_TENANT_ID,
      branchId: secondary.id,
      branch: secondary.name,
      customer: "Test delivery guest",
      channel: "Delivery",
      cashier: "Test system",
      lines: [
        {
          id: "line-test-002",
          productId: "product-test-002",
          name: "Test delivery item",
          category: "Test category",
          quantity: 1,
          unitPrice: 1000,
          productionStation: "MAIN KITCHEN",
        },
      ],
    },
    "SENT_TO_KITCHEN",
  );

  state.cashDrawers.push({
    id: "CDR-00001",
    tenantId: DEMO_TENANT_ID,
    branchId: primary.id,
    branch: primary.name,
    cashier: "Test cashier",
    openedAt: "2026-08-14T08:00:00+03:00",
    openingCash: 5000,
    cashSales: 1200,
    cashIn: 0,
    cashRefunds: 0,
    cashOut: 0,
    expectedDrawer: 6200,
    status: "OPEN",
  });

  return state;
}
