import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createLocalDevelopmentDatabase } from "../../src/server/database/local-development-database";

type Fixture = {
  tenantId: string;
  userId: string;
  restrictedUserId: string;
  managerAccessToken: string;
  restrictedAccessToken: string;
  firstBranchId: string;
  secondBranchId: string;
};

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), ".seramet", "e2e-fixture.json"), "utf8"),
) as Fixture;

test.describe.configure({ mode: "serial" });

test("authenticated manager completes scan, staging, recovery, publication and POS visibility", async ({
  browser,
}) => {
  const manager = await browser.newContext();
  await authorize(manager, fixture.userId, fixture.managerAccessToken, fixture.firstBranchId);
  const page = await manager.newPage();
  await page.goto("/menu-import");
  await expect(page.getByRole("button", { name: "Import menu" })).toBeEnabled();
  await page.getByRole("button", { name: "Import menu" }).click();

  const dialog = page.getByRole("dialog", { name: "Import menu" });
  await dialog.getByLabel("Existing-code policy").selectOption("CREATE");
  await dialog.getByLabel("Import target").selectOption("SELECTED_BRANCHES");
  const branchA = dialog.getByLabel(/Pilot Branch A/);
  if (!(await branchA.isChecked())) await branchA.check();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "browser-certified-menu.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(menuCsv(41)),
  });

  await expect(dialog.getByText("Browser imported 01", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Commit import" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Commit import" }).click();
  await expect(dialog.getByText(/Menu import queued as/)).toBeVisible();

  // Simulate navigation interruption. Recovery must inspect the same import instead of re-uploading.
  await page.reload();
  const publishDialog = page.getByRole("dialog", { name: "Publish verified menu import" });
  const publishButton = publishDialog.getByRole("button", { name: "Publish menu" });
  await expect(publishButton).toBeEnabled({
    timeout: 45_000,
  });
  await publishButton.click();
  await expect(
    page.getByText("Menu import published and verified in the authoritative catalogue."),
  ).toBeVisible({
    timeout: 45_000,
  });

  const published = await latestImport(page);
  expect(published.publishStatus).toBe("PUBLISHED");
  await page.goto("/pos");
  await expect(
    page.getByRole("button", { name: "Add Browser imported 01 to order" }),
  ).toBeVisible();

  const restricted = await browser.newContext();
  await authorize(
    restricted,
    fixture.restrictedUserId,
    fixture.restrictedAccessToken,
    fixture.secondBranchId,
  );
  const restrictedPage = await restricted.newPage();
  await restrictedPage.goto("/");
  for (const action of ["inspect", "commit", "publish"] as const) {
    const status = await restrictedPage.evaluate(
      async ({ importId, action }) => {
        const path =
          action === "inspect"
            ? `/api/seramet/setup/imports/${encodeURIComponent(importId)}`
            : `/api/seramet/setup/imports/${encodeURIComponent(importId)}/${action}`;
        const response = await fetch(path, {
          method: action === "inspect" ? "GET" : "POST",
          headers: { "content-type": "application/json" },
          ...(action === "inspect"
            ? {}
            : { body: JSON.stringify({ idempotencyKey: `unauthorized-${action}` }) }),
        });
        return response.status;
      },
      { importId: published.id, action },
    );
    expect(status).toBe(403);
  }
  await restricted.close();
  await manager.close();
});

test("scanner failures remain quarantined and never create a parsed preview", async ({
  browser,
}) => {
  const cases = [
    ["scanner-unavailable.csv", "SCAN_FAILED"],
    ["scanner-timeout.csv", "SCAN_FAILED"],
    ["scanner-infected.csv", "REJECTED_INFECTED"],
    ["scanner-malformed.csv", "SCAN_FAILED"],
    ["scanner-wrong-sha.csv", "SCAN_FAILED"],
    ["scanner-expired.csv", "SCAN_FAILED"],
    ["scanner-replay.csv", "SCAN_FAILED"],
    ["scanner-auth-failure.csv", "SCAN_FAILED"],
  ] as const;
  const contexts: BrowserContext[] = [];
  const jobs: Array<{ jobId: string; expectedState: string }> = [];
  try {
    for (const [index, [fileName, expectedState]] of cases.entries()) {
      const context = await browser.newContext();
      contexts.push(context);
      const useRestricted = index >= 4;
      await authorize(
        context,
        useRestricted ? fixture.restrictedUserId : fixture.userId,
        useRestricted ? fixture.restrictedAccessToken : fixture.managerAccessToken,
        useRestricted ? fixture.secondBranchId : fixture.firstBranchId,
      );
      const page = await context.newPage();
      await page.goto("/");
      const job = await uploadThroughApi(
        page,
        fileName,
        useRestricted ? fixture.secondBranchId : fixture.firstBranchId,
      );
      await expect
        .poll(async () => (await preparationStatus(page, job.jobId)).status, { timeout: 15_000 })
        .toBe("RETRY_PENDING");
      jobs.push({ jobId: job.jobId, expectedState });
    }

    const db = createLocalDevelopmentDatabase();
    try {
      for (const job of jobs) {
        const worker = await db
          .prepare("SELECT payload_json FROM worker_jobs WHERE tenant_id=? AND id=?")
          .bind(fixture.tenantId, job.jobId)
          .first<{ payload_json: string }>();
        expect(worker).toBeTruthy();
        const objectId = String(JSON.parse(worker!.payload_json).objectId);
        const stored = await db
          .prepare("SELECT status FROM stored_objects WHERE tenant_id=? AND id=?")
          .bind(fixture.tenantId, objectId)
          .first<{ status: string }>();
        expect(stored?.status).toBe("QUARANTINED");
        const parsed = await db
          .prepare(
            "SELECT COUNT(*) count FROM setup_imports WHERE tenant_id=? AND source_object_id=?",
          )
          .bind(fixture.tenantId, objectId)
          .first<number>("count");
        expect(Number(parsed)).toBe(0);
        const state = await db
          .prepare(
            "SELECT state FROM file_import_state_events WHERE tenant_id=? AND job_id=? ORDER BY created_at DESC,id DESC LIMIT 1",
          )
          .bind(fixture.tenantId, job.jobId)
          .first<string>("state");
        expect(state).toBe(job.expectedState);
      }
    } finally {
      db.close();
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

async function authorize(
  context: BrowserContext,
  userId: string,
  accessToken: string,
  branchId: string,
) {
  await context.addInitScript(
    ({ tenantId, userId, branchId }) => {
      if (!/^https?:$/.test(window.location.protocol)) return;
      sessionStorage.setItem("seramet.session.interactive-sign-in", "1");
      localStorage.setItem("seramet.session.tenant-id", tenantId);
      localStorage.setItem("seramet.session.user-id", userId);
      localStorage.setItem(
        "seramet.session.branch-scope.v2",
        JSON.stringify({ type: "BRANCH", branchId }),
      );
    },
    { tenantId: fixture.tenantId, userId, branchId },
  );
  await context.route("**/api/seramet/**", async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        authorization: `Bearer ${accessToken}`,
        "x-seramet-tenant-id": fixture.tenantId,
        "x-seramet-user-id": userId,
        "x-seramet-branch-id": route.request().headers()["x-seramet-branch-id"] ?? branchId,
      },
    });
  });
}

async function latestImport(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/seramet/setup/imports/recent");
    const body = (await response.json()) as {
      imports: Array<{ id: string }>;
    };
    const id = body.imports[0]!.id;
    const inspected = await fetch(`/api/seramet/setup/imports/${encodeURIComponent(id)}`);
    const detail = (await inspected.json()) as {
      preview: { id: string; publishStatus?: string };
    };
    return detail.preview;
  });
}

async function uploadThroughApi(page: Page, fileName: string, branchId: string) {
  return page.evaluate(
    async ({ fileName, branchId, csv }) => {
      const base64 = btoa(csv);
      const response = await fetch("/api/seramet/setup/imports/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "MENU",
          originalName: fileName,
          mimeType: "text/csv",
          base64,
          duplicateStrategy: "CREATE",
          idempotencyKey: `e2e-negative:${fileName}:${crypto.randomUUID()}`,
          targetMode: "SELECTED_BRANCHES",
          targetBranchIds: [branchId],
        }),
      });
      if (!response.ok) throw new Error(`Upload failed with ${response.status}`);
      const body = (await response.json()) as { job: { jobId: string } };
      return body.job;
    },
    { fileName, branchId, csv: menuCsv(1) },
  );
}

async function preparationStatus(page: Page, jobId: string) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/seramet/setup/imports/jobs/${encodeURIComponent(id)}`);
    const body = (await response.json()) as { job: { status: string } };
    return body.job;
  }, jobId);
}

function menuCsv(rows: number) {
  return [
    "templateVersion,itemCode,name,categoryCode,basePrice,currency,stationCode,available",
    ...Array.from(
      { length: rows },
      (_, index) =>
        `2,BROWSER-${String(index + 1).padStart(2, "0")},Browser imported ${String(index + 1).padStart(2, "0")},MAIN,125,KES,MAIN,true`,
    ),
  ].join("\n");
}
