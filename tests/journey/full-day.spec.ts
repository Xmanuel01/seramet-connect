import { test, expect, type Browser, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { createServer, type Server } from "node:net";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error - plain ESM bridge without type declarations
import { createBridge } from "../../local-print-bridge/server.mjs";
import { resolve } from "node:path";

const evidence = resolve(".seramet/journey/evidence");
mkdirSync(evidence, { recursive: true });
const auth = "https://127.0.0.1:54329";
const run = Date.now().toString(36);
const owner = {
  name: "Amina Otieno",
  email: `owner-${run}@journey.example.test`,
  password: `Journey-${run}-Pass!9`,
  restaurant: `Journey Grill ${run}`,
};
let step = 0;
async function shot(page: Page, name: string) {
  step += 1;
  await page.screenshot({
    path: resolve(evidence, `${String(step).padStart(2, "0")}-${name}.png`),
    fullPage: true,
  });
}
const authCa = readFileSync(resolve(".seramet/journey/auth-cert.pem"));
/** Talks to the Supabase stand-in's test controls (outbox, email confirmation). */
function authControl(path: string, body?: unknown): Promise<unknown> {
  return new Promise((done, fail) => {
    const request = httpsRequest(
      `${auth}${path}`,
      {
        method: body ? "POST" : "GET",
        ca: authCa,
        headers: { "content-type": "application/json" },
      },
      (response) => {
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () =>
          (response.statusCode ?? 500) < 300
            ? done(JSON.parse(text || "null"))
            : fail(new Error(`${path}: ${response.statusCode} ${text}`)),
        );
      },
    );
    request.on("error", fail);
    request.end(body ? JSON.stringify(body) : undefined);
  });
}

const menu = [
  { name: "Nyama Choma", category: "Mains", price: "1200", station: "Kitchen" },
  { name: "Chips Masala", category: "Sides", price: "350", station: "Kitchen" },
  { name: "Passion Juice", category: "Drinks", price: "250", station: "Bar" },
  { name: "Bottled Water", category: "Drinks", price: "100", station: "" },
];
export const staff = {
  cashier: { name: "Brian Mwangi", role: "Cashier", pin: "482913", code: "BRM" },
  chef: { name: "Grace Wanjiru", role: "Chef", pin: "715364", code: "GRW" },
  supervisor: { name: "Peter Kamau", role: "Supervisor", pin: "903172", code: "PEK" },
};
const codes: Record<keyof typeof staff, string> = { cashier: "", chef: "", supervisor: "" };
const newPins = { cashier: "538216", chef: "264819", supervisor: "190354" };
const pinReplaced: Record<keyof typeof staff, boolean> = {
  cashier: false,
  chef: false,
  supervisor: false,
};

/** Staff code + PIN on the POS keypad; replaces a temporary PIN on first sign-in. */
async function staffSignIn(page: Page, who: keyof typeof staff) {
  const signIn = async (pin: string) => {
    await page.goto("/pos-login");
    await page.getByLabel("Email or employee code").fill(codes[who]);
    for (const digit of pin) await page.getByRole("button", { name: digit, exact: true }).click();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  };
  if (pinReplaced[who]) {
    await signIn(newPins[who]);
    await expect(page).not.toHaveURL(/\/pos-login/);
    return;
  }
  await signIn(staff[who].pin);
  const replace = page.getByRole("heading", { name: "Replace temporary PIN" });
  // Either the first-time PIN change appears or the sign-in leaves the keypad.
  await expect
    .poll(async () => (await replace.isVisible()) || !page.url().includes("/pos-login"))
    .toBe(true);
  if (await replace.isVisible()) {
    await page.getByLabel("New PIN", { exact: true }).fill(newPins[who]);
    await page.getByLabel("Confirm new PIN", { exact: true }).fill(newPins[who]);
    await page.getByRole("button", { name: "Change PIN", exact: true }).click();
    await expect(page.getByText("PIN changed. Sign in with your new PIN.")).toBeVisible();
    pinReplaced[who] = true;
    await signIn(newPins[who]);
  }
  await expect(page).not.toHaveURL(/\/pos-login/);
}

async function ownerSignIn(page: Page) {
  await page.goto("/login?account=1");
  await page.getByLabel("Email", { exact: true }).fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function setupDevices(page: Page) {
  await page.goto("/seramet-setup");
  await page.getByRole("button", { name: /^Printers & devices/ }).click();
  await expect(page.getByRole("button", { name: "Register device", exact: true })).toBeVisible();
}

const continueButton = (page: Page) =>
  page.getByRole("button", { name: /^(Continue|Set up menu later|Skip for now)$/ });
async function next(page: Page, heading: string) {
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
}

test("full day: sign-up, onboarding, setup, trading and business-day close", async ({ page }) => {
  test.setTimeout(30 * 60_000);
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("response", (response) => {
    if (response.url().includes("/api/seramet/") && response.status() >= 500)
      problems.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });

  await test.step("1. Owner signs up and confirms their email", async () => {
    await page.goto("/register");
    await page.getByLabel("Your name").fill(owner.name);
    await page.getByLabel("Email", { exact: true }).fill(owner.email);
    await page.getByLabel("Password", { exact: true }).fill(owner.password);
    await shot(page, "register");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
    await shot(page, "verify-email");
    const outbox = (await authControl("/__journey/outbox")) as Array<{ email: string }>;
    expect(outbox.some((mail) => mail.email === owner.email)).toBe(true);
    await authControl("/__journey/confirm", { email: owner.email });
    await page.getByRole("button", { name: "I've verified my email" }).click();
    await expect(page).toHaveURL(/\/login\?account=1/);
    await page.getByLabel("Email", { exact: true }).fill(owner.email);
    await page.getByLabel("Password", { exact: true }).fill(owner.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "What is your business name?" })).toBeVisible();
  });

  await test.step("2. Guided onboarding creates the restaurant", async () => {
    await page.getByLabel("Restaurant name", { exact: true }).fill(owner.restaurant);
    await page.getByRole("button", { name: "Continue to location" }).click();
    await expect(
      page.getByRole("heading", { name: "Where is your business located?" }),
    ).toBeVisible();
    await page.getByRole("combobox", { name: "Country", exact: true }).selectOption("KE");
    await page.getByLabel("City / town").fill("Nairobi");
    await page.getByLabel("Street / building").fill("Waiyaki Way, Westlands");
    await page.getByLabel("This address is correct").check();
    await shot(page, "onboarding-location");
    await next(page, "Your currency");
    const base = page.getByRole("combobox", { name: "Primary / base currency" });
    if (!(await base.inputValue())) await base.selectOption("KES");
    await next(page, "What kind of business is this?");
    await page.getByRole("button", { name: /^Restaurant/ }).click();
    await next(page, "Your first branch");
    await page.getByLabel("Branch name").fill("Westlands");
    await page.getByLabel("Branch code").fill("WEST");
    await next(page, "Opening hours");
    await next(page, "How do customers order?");
    for (const mode of ["Dine-in", "Takeaway", "Own delivery", "Delivery apps"])
      await page.getByRole("checkbox", { name: mode, exact: true }).check();
    await shot(page, "onboarding-service-modes");
    await next(page, "Tax and service charge");
    await page.getByRole("checkbox", { name: /We charge VAT/ }).check();
    await page.getByLabel("Rate (%)").fill("16");
    await page.getByRole("combobox", { name: "Prices on the menu" }).selectOption("INCLUSIVE");
    await next(page, "How do customers pay?");
    for (const method of ["Cash", "M-Pesa", "Card"])
      await page.getByRole("checkbox", { name: method, exact: true }).check();
    await next(page, "Kitchen and stations");
    for (const station of ["Add Kitchen", "Add Bar"]) {
      const box = page.getByRole("checkbox", { name: station, exact: true });
      if (await box.count()) await box.check();
    }
    const kitchenMode = page.getByRole("combobox", { name: /How do orders reach the kitchen/ });
    await expect(kitchenMode).toHaveValue("KDS_ONLY");
    await kitchenMode.selectOption({ label: "Kitchen screens" });
    await shot(page, "onboarding-stations");
    await next(page, "Your first menu items");
    for (const item of menu) {
      await page.getByLabel("Item name").fill(item.name);
      await page.getByLabel("Category").fill(item.category);
      await page.getByLabel(/^Price/).fill(item.price);
      if (item.station)
        await page
          .getByRole("combobox", { name: "Prepared at" })
          .selectOption({ label: item.station });
      else await page.getByRole("combobox", { name: "Prepared at" }).selectOption("");
      await page.getByRole("button", { name: "Add item" }).click();
      await expect(page.getByText(item.name, { exact: true })).toBeVisible();
    }
    await shot(page, "onboarding-menu");
    await next(page, "Invite your team");
    for (const [key, person] of Object.entries(staff)) {
      await page.getByLabel("Full name").fill(person.name);
      await page.getByRole("combobox", { name: "Role" }).selectOption({ label: person.role });
      await page.getByLabel("Temporary 6-digit PIN").fill(person.pin);
      await page.getByLabel("Email", { exact: true }).fill(`${key}-${run}@journey.example.test`);
      await page
        .getByLabel("Phone")
        .fill(`+2547${String(10000000 + Object.keys(staff).indexOf(key))}`);
      await page.getByRole("button", { name: "Add team member" }).click();
      await expect(page.getByText(person.name, { exact: true })).toBeVisible();
      const row = page
        .locator("div")
        .filter({ hasText: person.name })
        .filter({ hasText: /code / })
        .last();
      codes[key as keyof typeof staff] = /code (\S+)/.exec(await row.innerText())![1]!;
    }
    await shot(page, "onboarding-team");
    await next(page, "Review your restaurant");
    await page.getByLabel(/standard restaurant chart of accounts/).check();
    await shot(page, "onboarding-review");
    await page.getByRole("button", { name: "Finish and open Setup Centre" }).click();
    await expect(page).toHaveURL(/\/seramet-setup/);
    await page.waitForLoadState("networkidle");
    await shot(page, "setup-centre");
  });

  await test.step("3. Owner registers the front till, a kitchen screen and tables", async () => {
    await setupDevices(page);
    const form = page.locator("form").filter({ hasText: "Register device" });
    const register = async (type: string, name: string, station?: string) => {
      await form.getByRole("combobox", { name: "Branch" }).selectOption({ label: "Westlands" });
      await form.getByRole("combobox", { name: "Device type" }).selectOption(type);
      await form.getByLabel("Device name").fill(name);
      if (station)
        await form.getByRole("combobox", { name: "Station" }).selectOption({ label: station });
      await form.getByRole("button", { name: "Register device" }).click();
      await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
    };
    await register("POS_TERMINAL", "Front till");
    await register("KDS", "Kitchen screen", "Kitchen");
    await page
      .getByRole("row")
      .filter({ hasText: "Front till" })
      .getByRole("button", { name: "Activate", exact: true })
      .click();
    await expect(page.getByText(/securely activated for employee POS sign-in/)).toBeVisible();
    await shot(page, "devices");
    await page.goto("/tables");
    for (const table of ["T1", "T2"]) {
      await page.getByRole("button", { name: "Add table", exact: true }).click();
      await page.getByLabel("Table number", { exact: true }).fill(table);
      await page.getByRole("button", { name: "Create table", exact: true }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
    }
    await expect(page.getByRole("button", { name: /^Table T2\b/ })).toBeVisible();
    await shot(page, "tables");
  });

  // A stand-in kitchen printer (raw TCP, port 9100 style) behind the real print bridge.
  const printed: Buffer[] = [];
  const kitchenPrinter: Server = createServer((socket) =>
    socket.on("data", (b) => printed.push(b)),
  );
  await new Promise<void>((done) => kitchenPrinter.listen(0, "127.0.0.1", done));
  let bridge: { server: Server; close: () => Promise<void> } | undefined;

  const browser = page.context().browser() as Browser;
  const kitchen = await (
    await browser.newContext({ viewport: { width: 1280, height: 900 } })
  ).newPage();

  await test.step("4. Kitchen tablet is activated and the chef signs in", async () => {
    await ownerSignIn(kitchen);
    await setupDevices(kitchen);
    await kitchen
      .getByRole("row")
      .filter({ hasText: "Kitchen screen" })
      .getByRole("button", { name: "Activate", exact: true })
      .click();
    await expect(kitchen.getByText(/securely activated/)).toBeVisible();
    await staffSignIn(kitchen, "chef");
    await kitchen.goto("/kitchen");
    await expect(kitchen.getByRole("heading", { name: "Kitchen display" })).toBeVisible();
    await shot(kitchen, "kitchen-empty");
  });

  await test.step("5. Cashier signs in at the till and opens the cash drawer", async () => {
    await staffSignIn(page, "cashier");
    await expect(page).toHaveURL(/\/pos$/);
    await page.goto("/payment-control");
    await page.getByRole("tab", { name: "Cash drawers", exact: true }).click();
    await page.getByLabel("Cash counted into the drawer").fill("5000");
    await page.getByRole("button", { name: "Open drawer", exact: true }).click();
    await expect(page.getByText("Cash drawer opened.")).toBeVisible();
    await shot(page, "drawer-open");
  });

  const placeOrder = async (
    channel: string,
    items: Array<[string, number]>,
    extra?: (page: Page) => Promise<void>,
  ) => {
    await page.goto("/pos");
    await page.getByRole("button", { name: channel, exact: true }).click();
    for (const [name, quantity] of items) {
      await page.getByPlaceholder("Search dishes or scan barcode").fill(name);
      await page.getByRole("button", { name: `Add ${name} to order`, exact: true }).click();
      for (let n = 1; n < quantity; n++)
        await page.getByRole("button", { name: `Add ${name}`, exact: true }).click();
    }
    await extra?.(page);
    const before = await orderIds(page);
    await page.getByRole("button", { name: "Place Order", exact: true }).click();
    await expect.poll(async () => (await orderIds(page)).length).toBe(before.length + 1);
    const id = (await orderIds(page)).find((order) => !before.includes(order))!;
    await shot(page, `order-${channel.toLowerCase().replace(/\W+/g, "-")}`);
    return id;
  };

  const orders: Record<string, string> = {};
  await test.step("6a. With kitchen screens only (no printer), a takeaway reaches the chef", async () => {
    orders.takeaway = await placeOrder(
      "Takeaway",
      [
        ["Nyama Choma", 1],
        ["Passion Juice", 2],
      ],
      // Menu prices include 16% VAT: the till shows it as included, never as zero.
      async (pos) => {
        const included = pos.getByText("Included tax and service").first();
        await expect(included).toBeVisible();
        await expect(included.locator("xpath=following-sibling::dd")).not.toHaveText(/\b0\.00$/);
      },
    );
    const takeaway = (await state(page)).orders.find((order) => order.id === orders.takeaway)!;
    expect(takeaway.tax).toBeGreaterThan(0);
    await kitchen.reload();
    await expect(
      kitchen.getByRole("article").filter({ hasText: orders.takeaway! }).first(),
    ).toBeVisible();
    await shot(kitchen, "kitchen-screen-only");
  });

  await test.step("6b. Owner adds a kitchen printer and connects the print bridge", async () => {
    await ownerSignIn(page);
    await page.goto("/seramet-printers");
    await page.getByRole("button", { name: "Add printer", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Kitchen printer");
    await page.getByRole("combobox", { name: "How it connects", exact: true }).selectOption("TCP");
    await page.getByLabel("Printer IP address", { exact: true }).fill("127.0.0.1");
    await page
      .getByLabel("Port", { exact: true })
      .fill(String((kitchenPrinter.address() as { port: number }).port));
    for (const role of ["Bills", "Receipts"])
      await page.getByRole("checkbox", { name: role, exact: true }).uncheck();
    for (const role of ["Kitchen tickets", "Bar tickets"])
      await page.getByRole("checkbox", { name: role, exact: true }).check();
    for (const station of ["Kitchen", "Bar"])
      await page.getByRole("checkbox", { name: station, exact: true }).check();
    await page
      .getByRole("combobox", { name: "This branch sends kitchen orders to" })
      .selectOption({ label: "Kitchen screens and printers" });
    if (!(await page.getByLabel("Print bridge ID").isVisible()))
      await page.getByText("More printer settings", { exact: true }).click();
    await page.getByLabel("Print bridge ID").fill("journey-kitchen-bridge");
    await page.getByRole("button", { name: "Save printer", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Printer saved");
    // Install the bridge by hand: its setup file comes from the Printers page.
    await page.getByText("Troubleshooting (for technicians)", { exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Bridge setup file" }).click();
    const config = JSON.parse(await readFile((await (await download).path())!, "utf8"));
    bridge = await createBridge(
      { ...config, dataDir: await mkdtemp(join(tmpdir(), "journey-bridge-")) },
      { localTest: true },
    );
    await new Promise<void>((done) => bridge!.server.listen(0, "127.0.0.1", () => done()));
    await page
      .getByLabel("Local bridge endpoint")
      .fill(`http://127.0.0.1:${(bridge!.server.address() as { port: number }).port}`);
    await page.getByLabel("Local bridge token").fill(config.token);
    await page.getByLabel("Enable installed bridge").check();
    await page.getByRole("button", { name: "Save local connection", exact: true }).click();
    await page.getByRole("button", { name: "Test kitchen ticket", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Sent to the printer" })).toBeVisible();
    await expect.poll(() => Buffer.concat(printed).toString("latin1")).toContain("PRINTER TEST");
    printed.length = 0;
    await shot(page, "kitchen-printer");
  });

  await test.step("6c. Cashier takes dine-in and delivery orders (screens and printer)", async () => {
    await staffSignIn(page, "cashier");
    orders.dineIn = await placeOrder(
      "Dine-in",
      [
        ["Chips Masala", 2],
        ["Bottled Water", 2],
      ],
      async (pos) => {
        await pos.getByRole("button", { name: "Place Order", exact: true }).click();
        const picker = pos.getByRole("dialog", { name: "Select table", exact: true });
        await picker.getByRole("button", { name: /^Table T1 / }).click();
      },
    );
    orders.delivery = await placeOrder("Own delivery", [["Nyama Choma", 2]], async (pos) => {
      await pos.getByLabel("Customer name", { exact: true }).fill("Wanjiku Njeri");
      await pos
        .getByLabel("Delivery address", { exact: true })
        .fill("Kileleshwa, Othaya Road, Apt 4B");
    });
  });

  await test.step("7. Chef prepares the tickets on the kitchen screen", async () => {
    await kitchen.reload();
    await expect(kitchen.getByRole("heading", { name: "Kitchen display" })).toBeVisible();
    for (const id of Object.values(orders)) {
      // Every order has a kitchen or bar item, so each must reach the kitchen screen.
      const ticket = kitchen.getByRole("article").filter({ hasText: id }).first();
      await expect(ticket).toBeVisible();
      for (const action of ["Start", "Ready", "Served"]) {
        await ticket.getByRole("button", { name: action, exact: true }).click();
        if (action !== "Served")
          await expect(ticket.getByRole("button", { name: action, exact: true })).toHaveCount(0);
      }
    }
    await shot(kitchen, "kitchen-served");
    // Kitchen tickets also printed on the kitchen printer (Kitchen screens and printers).
    const tickets = Buffer.concat(printed).toString("latin1");
    // Only orders placed after the printer was added print; the first went to screens only.
    expect(tickets).toContain(orders.dineIn!);
    expect(tickets).toContain(orders.delivery!);
    expect(tickets).not.toContain(orders.takeaway!);
  });

  const settle = async (orderId: string, method: string, reference?: string) => {
    await page.goto("/pos");
    await page.getByRole("button", { name: /^Orders/ }).click();
    await page.getByRole("button", { name: new RegExp(`^${orderId}`) }).click();
    await page.getByRole("button", { name: /^Bill / }).click();
    await page
      .getByRole("dialog", { name: `Bill ${orderId}`, exact: true })
      .getByRole("button", { name: "Don't print bill", exact: true })
      .click();
    await page.goto("/invoices");
    const bill = (await state(page)).bills.find((row) => row.orderIds.includes(orderId))!;
    await page
      .getByRole("row")
      .filter({ hasText: bill.id.replace(/^(?:BILL|INV)-/, "") })
      .getByRole("button", { name: "Settle", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: method, exact: true }).click();
    await page.getByLabel("Amount", { exact: true }).fill(bill.total.toFixed(2));
    if (reference)
      await dialog
        .getByLabel(/reference|code|transaction|approval/i)
        .first()
        .fill(reference);
    await dialog.getByRole("button", { name: "Settle invoice", exact: true }).click();
    await expect(page.getByText("Settlement recorded", { exact: true })).toBeVisible();
    return bill.total;
  };

  const takings: Record<string, number> = {};
  await test.step("8. Cashier bills and settles each order (cash, M-Pesa, card)", async () => {
    takings.cash = await settle(orders.takeaway!, "Cash");
    takings.mpesa = await settle(orders.dineIn!, "M-Pesa", "QHT4K2LM9X");
    takings.card = await settle(orders.delivery!, "Card", "AUTH-482913");
    await shot(page, "invoices-settled");
  });

  await test.step("9. Supervisor counts the drawer and closes the business day", async () => {
    await staffSignIn(page, "supervisor");
    await page.goto("/payment-control");
    await page.getByRole("button", { name: "Daily closing", exact: true }).click();
    const drawer = (await state(page)).paymentOperations!.drawerSessions.find(
      (row) => row.status === "OPEN",
    )!;
    const counted = (5000 + takings.cash!).toFixed(2);
    // Default "Supervisor-led daily closing": the drawer is counted while closing the day.
    await page.getByRole("button", { name: "Close Business Day", exact: true }).click();
    const close = page.getByRole("dialog", { name: "Close Business Day", exact: true });
    await close.getByLabel(`Counted KES ${drawer.id}`, { exact: true }).fill(counted);
    await close.getByRole("button", { name: "Review confirmation", exact: true }).click();
    await shot(page, "close-day-confirm");
    await close.getByRole("button", { name: "Confirm & Close Business Day", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Day closed." })).toBeVisible();
    const day = (await state(page)).paymentOperations!.dayCloses.find(
      (row) => row.status === "CLOSED",
    )!;
    const total = Math.round((takings.cash! + takings.mpesa! + takings.card!) * 100);
    expect(day.snapshot!.invoicedMinor).toBe(total);
    expect(day.snapshot!.settledMinor).toBe(total);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF", exact: true }).click();
    await (await download).saveAs(resolve(evidence, "closing-report.pdf"));
    await shot(page, "day-closed");
  });

  await test.step("10. Owner connects Uber Eats for the branch (testing mode)", async () => {
    await ownerSignIn(page);
    await page.goto("/seramet-setup");
    await page.getByRole("button", { name: /^Delivery integrations/ }).click();
    const panel = page
      .locator("div")
      .filter({ has: page.getByText("Uber Eats", { exact: true }) })
      .last();
    await page
      .getByRole("combobox", { name: "Branch" })
      .last()
      .selectOption({ label: "Westlands" });
    await page.getByLabel("Uber store ID").fill("4f8c2a51-7d3e-4b9a-9c61-2e5d8f0a7b13");
    await page.getByLabel("Client ID").fill("journey-uber-client-id");
    await page.getByLabel("Client secret", { exact: true }).fill("journey-uber-client-secret");
    await page.getByRole("button", { name: "Connect and test" }).click();
    // This container cannot reach Uber, so the saved connection reports a clear failure.
    await expect(page.getByText(/Connected to Uber Eats|test didn't pass/)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/Webhook address for Uber/)).toBeVisible();
    await expect(
      page
        .locator("code")
        .filter({ hasText: "/api/seramet/integrations/webhooks/UBER_EATS/uber-eats-" }),
    ).toBeVisible();
    await shot(page, "uber-eats");
    void panel;
  });

  expect(problems, problems.join("\n")).toEqual([]);
});

async function state(page: Page) {
  const response = await page.request.get("/api/seramet/transactions");
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json())
    .state as import("../../src/lib/transaction-engine").TransactionState;
}
async function orderIds(page: Page) {
  return (await state(page)).orders.map((order) => order.id);
}
