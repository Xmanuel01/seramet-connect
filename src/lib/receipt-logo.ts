export type LogoScope = "Company" | "Branch";

/** Matches MAX_LOGO_WIDTH and MAX_LOGO_HEIGHT in printing-core/thermal-layout.mjs. */
export const RECEIPT_LOGO_MAX_WIDTH = 384;
export const RECEIPT_LOGO_MAX_HEIGHT = 200;

/** The printable form saved on the server: packed 1-bit rows, base64. */
export type PrintableReceiptLogo = { width: number; height: number; data: string };

export type ReceiptLogoAsset = {
  id: string;
  scope: LogoScope;
  branch?: string;
  fileName: string;
  originalDataUrl: string;
  monochromeDataUrl: string;
  escposHex: string;
  width: number;
  height: number;
  threshold: number;
  fallbackText: string;
};

export type MonochromeBitmap = {
  pixels: Uint8Array;
  packedHex: string;
  width: number;
  height: number;
};

export function convertRgbaToMonochrome(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 150,
): MonochromeBitmap {
  const pixels = new Uint8Array(width * height);
  const rowBytes = Math.ceil(width / 8);
  const packed = new Uint8Array(rowBytes * height);
  for (let index = 0; index < width * height; index += 1) {
    const source = index * 4;
    const alpha = data[source + 3] ?? 255;
    const luminance =
      alpha === 0
        ? 255
        : (data[source] ?? 0) * 0.299 +
          (data[source + 1] ?? 0) * 0.587 +
          (data[source + 2] ?? 0) * 0.114;
    const black = luminance < threshold ? 1 : 0;
    pixels[index] = black;
    if (black) {
      const x = index % width;
      const y = Math.floor(index / width);
      const packedIndex = y * rowBytes + Math.floor(x / 8);
      packed[packedIndex] = (packed[packedIndex] ?? 0) | (0x80 >> (x % 8));
    }
  }
  return {
    pixels,
    packedHex: Array.from(packed)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
    width,
    height,
  };
}

export async function processReceiptLogoFile(
  file: File,
  scope: LogoScope,
  branch?: string,
  threshold = 150,
  businessName = "Business logo",
): Promise<ReceiptLogoAsset> {
  const originalDataUrl = await fileToDataUrl(file);
  const image = await createImageBitmap(file);
  // Fits 58mm paper and every 80mm printer, and about 25mm tall at 203 dpi.
  const scale = Math.min(
    1,
    RECEIPT_LOGO_MAX_WIDTH / image.width,
    RECEIPT_LOGO_MAX_HEIGHT / image.height,
  );
  const width = Math.max(8, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not process receipt logo");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const mono = convertRgbaToMonochrome(imageData.data, width, height, threshold);
  for (let index = 0; index < mono.pixels.length; index += 1) {
    const value = mono.pixels[index] ? 0 : 255;
    const source = index * 4;
    imageData.data[source] = value;
    imageData.data[source + 1] = value;
    imageData.data[source + 2] = value;
    imageData.data[source + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  const asset: ReceiptLogoAsset = {
    id: `LOGO-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase(),
    scope,
    fileName: file.name,
    originalDataUrl,
    monochromeDataUrl: canvas.toDataURL("image/png"),
    escposHex: mono.packedHex,
    width,
    height,
    threshold,
    fallbackText: scope === "Branch" && branch ? `${branch} Branch` : businessName,
  };
  if (branch) asset.branch = branch;
  return asset;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function toPrintableLogo(asset: ReceiptLogoAsset): PrintableReceiptLogo {
  const bytes = asset.escposHex.match(/../g)?.map((pair) => parseInt(pair, 16)) ?? [];
  return {
    width: asset.width,
    height: asset.height,
    data: btoa(String.fromCharCode(...bytes)),
  };
}

/** Draws a saved logo as black on white, the way the printer will. */
export function printableLogoToDataUrl(logo: PrintableReceiptLogo) {
  const bytes = Uint8Array.from(atob(logo.data), (character) => character.charCodeAt(0));
  const stride = Math.ceil(logo.width / 8);
  const canvas = document.createElement("canvas");
  canvas.width = logo.width;
  canvas.height = logo.height;
  const context = canvas.getContext("2d");
  if (!context) return "";
  const image = context.createImageData(logo.width, logo.height);
  for (let y = 0; y < logo.height; y += 1)
    for (let x = 0; x < logo.width; x += 1) {
      const black = (bytes[y * stride + (x >> 3)] ?? 0) & (0x80 >> (x & 7));
      const index = (y * logo.width + x) * 4;
      const value = black ? 0 : 255;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}
