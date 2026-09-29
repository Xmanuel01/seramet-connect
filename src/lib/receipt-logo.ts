export type LogoScope = "Company" | "Branch";

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
  const maxWidth = 384;
  const scale = image.width > maxWidth ? maxWidth / image.width : 1;
  const width = Math.max(1, Math.round(image.width * scale));
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
