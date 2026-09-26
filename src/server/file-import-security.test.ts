import { describe, expect, it } from "vitest";
import { validateImportFile } from "@/server/file-import-security";

const input = {
  kind: "MENU" as const,
  filename: "menu.csv",
  contentType: "text/csv",
  bytes: new TextEncoder().encode("code,name\nITEM-1,Item one"),
};

describe("file import malware scanning", () => {
  it("fails closed when no scanner is configured", async () => {
    await expect(validateImportFile(input)).rejects.toMatchObject({
      code: "EXTERNAL_SERVICE_UNAVAILABLE",
      status: 503,
    });
  });

  it("rejects an infected file", async () => {
    await expect(
      validateImportFile({
        ...input,
        scanner: {
          async scan() {
            return { status: "INFECTED" };
          },
        },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 422 });
  });

  it.each([
    {
      async scan() {
        return { status: "ERROR" as const };
      },
    },
    {
      async scan(): Promise<never> {
        throw new Error("scanner unavailable");
      },
    },
  ])("treats scanner errors as unavailable", async (scanner) => {
    await expect(validateImportFile({ ...input, scanner })).rejects.toMatchObject({
      code: "EXTERNAL_SERVICE_UNAVAILABLE",
      status: 503,
    });
  });

  it("returns server-generated clean evidence bound to the exact file digest", async () => {
    const result = await validateImportFile({
      ...input,
      scanner: {
        async scan() {
          return { status: "CLEAN", reference: "scan://provider/result-1" };
        },
      },
    });
    expect(result.scanEvidence).toMatchObject({
      status: "CLEAN",
      fileDigest: result.digest,
      reference: "scan://provider/result-1",
    });
  });
});
