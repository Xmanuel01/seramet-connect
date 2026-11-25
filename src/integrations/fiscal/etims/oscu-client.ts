// KRA eTIMS Online Sales Control Unit (OSCU) client, per KRA's "OSCU
// Specification Document v2.0" (https://www.kra.go.ke/images/publications/
// OSCU_Specification_Document_v2.0.pdf).
//
// Every call is a JSON POST to the OSCU API server. The taxpayer PIN (tin),
// branch office id (bhfId) and communication key (cmcKey) identify the caller;
// they are sent as request headers (KRA answers "900 No Header information"
// without them) and in the body, where the specification lists them as fields.
// resultCd "000" is success; every other code is reported, never ignored.

export type OscuEnvironment = "SANDBOX" | "PRODUCTION";

export const OSCU_BASE_URLS: Record<OscuEnvironment, string> = {
  SANDBOX: "https://etims-api-sbx.kra.go.ke/etims-api",
  PRODUCTION: "https://etims-api.kra.go.ke/etims-api",
};

/** Result codes, section 4.18 of the specification. */
export const OSCU_RESULT_CODES: Record<string, string> = {
  "000": "Succeeded",
  "001": "No search result",
  "891": "Error creating request URL",
  "892": "Error creating request header data",
  "893": "Error creating request body data",
  "894": "Error in server communication",
  "895": "Unallowed request method",
  "896": "Error regarding request status",
  "899": "Error regarding client",
  "900": "No header information",
  "901": "Not a valid device",
  "902": "Device already installed",
  "903": "Only OSCU device can be verified",
  "910": "Request parameter error",
  "911": "No request full text",
  "912": "Request method error",
  "921": "Declared sales or sales invoice data cannot be received",
  "922": "Sales invoice data can be received only after sales data is received",
  "990": "Maximum number of views exceeded",
  "991": "Registration error",
  "992": "Modification error",
  "993": "Deletion error",
  "994": "Overlapping data",
  "995": "No downloaded file",
  "999": "Unknown error; contact the administrator",
};

export class OscuError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** True when the same request may succeed if sent again (network, timeout, KRA busy). */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "OscuError";
  }
}

export type OscuAuth = { tin: string; bhfId: string; cmcKey: string };

export type OscuDevice = {
  taxpayerName?: string;
  branchName?: string;
  deviceId?: string;
  /** SCU id printed as "CU ID" (the specification's response spells it sdicId). */
  sdcId: string;
  mrcNo?: string;
  cmcKey: string;
};

/** ItemSaveReq (/saveItem). */
export type OscuItem = {
  itemCd: string;
  itemClsCd: string;
  itemTyCd: "1" | "2" | "3";
  itemNm: string;
  orgnNatCd: string;
  pkgUnitCd: string;
  qtyUnitCd: string;
  taxTyCd: "A" | "B" | "C" | "D" | "E";
  dftPrc: number;
  isrcAplcbYn: "Y" | "N";
  useYn: "Y" | "N";
  regrId: string;
  regrNm: string;
  modrId: string;
  modrNm: string;
};

/** One line of TrnsSalesSaveWrReq.itemList. */
export type OscuSaleItem = {
  itemSeq: number;
  itemCd: string;
  itemClsCd: string;
  itemNm: string;
  pkgUnitCd: string;
  pkg: number;
  qtyUnitCd: string;
  qty: number;
  prc: number;
  splyAmt: number;
  dcRt: number;
  dcAmt: number;
  taxTyCd: "A" | "B" | "C" | "D" | "E";
  taxblAmt: number;
  taxAmt: number;
  totAmt: number;
};

type TaxBy<T extends string> = Record<`${T}${"A" | "B" | "C" | "D" | "E"}`, number>;

/** TrnsSalesSaveWrReq (/saveTrnsSalesOsdc), without tin/bhfId/cmcKey. */
export type OscuSale = {
  trdInvcNo: string;
  invcNo: number;
  orgInvcNo: number;
  custTin?: string;
  custNm?: string;
  rcptTyCd: "S" | "R";
  pmtTyCd?: "01" | "02" | "03" | "04" | "05" | "06" | "07";
  salesSttsCd: "02";
  cfmDt: string;
  salesDt: string;
  totItemCnt: number;
  totTaxblAmt: number;
  totTaxAmt: number;
  totAmt: number;
  prchrAcptcYn: "N" | "Y";
  remark?: string;
  regrId: string;
  regrNm: string;
  modrId: string;
  modrNm: string;
  receipt: {
    custTin?: string;
    custMblNo?: string;
    rcptPbctDt: string;
    trdeNm?: string;
    adrs?: string;
    topMsg?: string;
    btmMsg?: string;
    prchrAcptcYn: "N" | "Y";
  };
  itemList: OscuSaleItem[];
} & TaxBy<"taxblAmt"> &
  TaxBy<"taxRt"> &
  TaxBy<"taxAmt">;

/** TrnsSalesSaveWrRes.data: what KRA's control unit signed. */
export type OscuSignature = {
  curRcptNo: number;
  totRcptNo: number;
  intrlData: string;
  rcptSign: string;
  sdcDateTime: string;
};

export type OscuClientOptions = {
  environment: OscuEnvironment;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export function createOscuClient(options: OscuClientOptions) {
  const base = OSCU_BASE_URLS[options.environment];
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 20_000;

  async function post<T>(
    path: string,
    identity: { tin: string; bhfId: string; cmcKey?: string },
    body: Record<string, unknown>,
  ): Promise<{ data: T; resultMsg: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await send(`${base}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          tin: identity.tin,
          bhfId: identity.bhfId,
          ...(identity.cmcKey ? { cmcKey: identity.cmcKey } : {}),
        },
        body: JSON.stringify({ ...identity, ...body }),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new OscuError(
        "894",
        aborted ? "KRA eTIMS did not answer in time" : "Could not reach KRA eTIMS",
        true,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok)
      throw new OscuError(
        "894",
        `KRA eTIMS answered HTTP ${response.status}`,
        response.status >= 500 || response.status === 429,
      );
    let json: { resultCd?: string; resultMsg?: string; data?: unknown };
    try {
      json = (await response.json()) as typeof json;
    } catch {
      throw new OscuError("894", "KRA eTIMS sent an unreadable answer", true);
    }
    const code = String(json.resultCd ?? "");
    if (code !== "000") {
      const known = OSCU_RESULT_CODES[code];
      throw new OscuError(
        code || "999",
        `KRA eTIMS ${code || "error"}: ${json.resultMsg || known || "request failed"}`,
        code === "894" || code === "999",
      );
    }
    return { data: json.data as T, resultMsg: json.resultMsg ?? "" };
  }

  return {
    environment: options.environment,

    /** /selectInitOsdcInfo: activates the OSCU for this PIN, branch and device serial. */
    async initialize(input: { tin: string; bhfId: string; dvcSrlNo: string }): Promise<OscuDevice> {
      const { data } = await post<{
        info?: Record<string, unknown>;
      }>(
        "/selectInitOsdcInfo",
        { tin: input.tin, bhfId: input.bhfId },
        { dvcSrlNo: input.dvcSrlNo },
      );
      // The specification nests taxpayer, branch and device objects; some
      // responses flatten them. Read both.
      const info = (data?.info ?? {}) as Record<string, unknown>;
      const pick = (key: string) => {
        for (const scope of [info, info["InitDevice"], info["InitTaxpayer"], info["InitBranch"]])
          if (scope && typeof scope === "object" && key in scope) {
            const value = (scope as Record<string, unknown>)[key];
            if (value !== null && value !== undefined && String(value).trim()) return String(value);
          }
        return undefined;
      };
      const cmcKey = pick("cmcKey");
      const sdcId = pick("sdcId") ?? pick("sdicId");
      if (!cmcKey || !sdcId)
        throw new OscuError("899", "KRA eTIMS activation returned no communication key", false);
      return {
        cmcKey,
        sdcId,
        ...(pick("mrcNo") ? { mrcNo: pick("mrcNo") } : {}),
        ...(pick("dvcId") ? { deviceId: pick("dvcId") } : {}),
        ...(pick("taxprNm") ? { taxpayerName: pick("taxprNm") } : {}),
        ...(pick("bhfNm") ? { branchName: pick("bhfNm") } : {}),
      };
    },

    /** /saveItem: registers an item (or updates it) before it is sold. */
    async saveItem(auth: OscuAuth, item: OscuItem) {
      await post("/saveItem", auth, item);
    },

    /** /saveTrnsSalesOsdc: sends a sale and returns KRA's signature for the receipt. */
    async saveSale(auth: OscuAuth, sale: OscuSale): Promise<OscuSignature> {
      const { data } = await post<Partial<OscuSignature>>("/saveTrnsSalesOsdc", auth, sale);
      if (
        !data ||
        typeof data.rcptSign !== "string" ||
        !data.rcptSign ||
        typeof data.intrlData !== "string" ||
        data.curRcptNo === undefined ||
        data.totRcptNo === undefined ||
        !data.sdcDateTime
      )
        throw new OscuError("899", "KRA eTIMS accepted the sale but returned no signature", false);
      return {
        curRcptNo: Number(data.curRcptNo),
        totRcptNo: Number(data.totRcptNo),
        intrlData: data.intrlData,
        rcptSign: data.rcptSign,
        sdcDateTime: String(data.sdcDateTime),
      };
    },
  };
}

export type OscuClient = ReturnType<typeof createOscuClient>;
