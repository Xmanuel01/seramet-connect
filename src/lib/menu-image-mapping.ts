import type { Product } from "@/data/mock";

export type MenuImageMapping = {
  fileName: string;
  itemKey: string;
  itemName?: string;
  productId?: string;
  status: "Matched" | "Unmatched";
  imageUrl?: string;
  compressedUrl?: string;
  originalBytes?: number;
  compressedBytes?: number;
};

const imageExtensions = /\.(png|jpe?g|webp|gif)$/i;

export function imageKeyFromFilename(fileName: string) {
  return fileName
    .replace(imageExtensions, "")
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .toLowerCase();
}

export function productImageKey(product: Product) {
  return [
    product.id,
    product.itemCode,
    product.sku,
    product.imageFilename,
    product.name,
    `${product.category}-${product.name}`,
  ]
    .filter(Boolean)
    .map((value) => imageKeyFromFilename(String(value)));
}

export function mapImageNamesToMenu(fileNames: string[], products: Product[]): MenuImageMapping[] {
  return fileNames.map((fileName) => {
    const itemKey = imageKeyFromFilename(fileName);
    const product = products.find((candidate) => productImageKey(candidate).includes(itemKey));
    return {
      fileName,
      itemKey,
      itemName: product?.name,
      productId: product?.id,
      status: product ? "Matched" : "Unmatched",
    };
  });
}

export async function mapImageFilesToMenu(
  files: File[],
  products: Product[],
): Promise<MenuImageMapping[]> {
  const nameMappings = mapImageNamesToMenu(
    files.map((file) => file.name),
    products,
  );
  return Promise.all(
    nameMappings.map(async (mapping, index) => {
      const file = files[index];
      if (!file) return mapping;
      const imageUrl = URL.createObjectURL(file);
      const compressed = await compressMenuImage(file).catch(() => undefined);
      return {
        ...mapping,
        imageUrl,
        compressedUrl: compressed?.dataUrl ?? imageUrl,
        originalBytes: file.size,
        compressedBytes: compressed?.bytes ?? file.size,
      };
    }),
  );
}

export async function compressMenuImage(file: File, maxSize = 720, quality = 0.82) {
  const image = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not compress menu image");
  context.drawImage(image, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/webp", quality);
  return {
    dataUrl,
    width,
    height,
    bytes: Math.round((dataUrl.length * 3) / 4),
  };
}
