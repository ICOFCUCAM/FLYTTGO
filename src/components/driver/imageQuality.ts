/**
 * A quick look at a document photo before it is sent (owner, 31 October 2026): too dark, or too blurry to
 * read? Done in the browser on a small copy of the picture; it only warns, never refuses (the approvals team
 * decides). PDFs and anything the browser cannot draw are not checked. Never throws.
 */
export interface PhotoCheck { dark: boolean; blurry: boolean }

/** Mean luminance (0–255) and the variance of the Laplacian (sharpness) of greyscale pixels. */
export function measure(grey: Uint8ClampedArray | number[], width: number, height: number): { brightness: number; sharpness: number } {
  let sum = 0;
  for (let i = 0; i < grey.length; i++) sum += grey[i];
  const brightness = grey.length ? sum / grey.length : 0;
  let n = 0, mean = 0, m2 = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = grey[i - width] + grey[i + width] + grey[i - 1] + grey[i + 1] - 4 * grey[i];
      n++;
      const d = lap - mean;
      mean += d / n;
      m2 += d * (lap - mean);
    }
  }
  return { brightness, sharpness: n > 1 ? m2 / (n - 1) : 0 };
}

export const DARK_BELOW = 60;
export const BLURRY_BELOW = 40;

export function judge(m: { brightness: number; sharpness: number }): PhotoCheck {
  return { dark: m.brightness < DARK_BELOW, blurry: m.sharpness < BLURRY_BELOW };
}

export async function checkPhoto(file: File): Promise<PhotoCheck | null> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
    const w = Math.max(8, Math.round(bmp.width * scale)), h = Math.max(8, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const grey = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j++) grey[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    return judge(measure(grey, w, h));
  } catch {
    return null;
  }
}
