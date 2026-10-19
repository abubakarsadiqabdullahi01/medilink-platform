/**
 * Photographs are made smaller before they are sent (UXA-10).
 *
 * A phone's camera makes a 4–8 MB JPEG of a licence, and over a weak mobile connection that is the
 * difference between an upload that finishes and one that dies at 80% and is started again from
 * nothing. A document is just as legible at 2000 pixels on its long side, which is a tenth of the
 * bytes; so images are redrawn at that size and re-encoded before they leave the phone.
 *
 * Only what can be done safely is done. A PDF is sent as it is. An image the browser cannot decode
 * (HEIC on most browsers) is sent as it is. And if the redrawn picture comes out no smaller, the
 * original goes: this must never make a file worse.
 */

const MAX_EDGE = 2000;
const QUALITY = 0.85;
/** Below this a photograph is already small enough that redrawing it is all cost. */
const LEAVE_ALONE_BELOW = 500 * 1024;
const COMPRESSIBLE = ['image/jpeg', 'image/png', 'image/webp'];

/** The size to draw at: the same shape, with the longer side no more than `max`, and never larger. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export async function compressImage(file: File): Promise<File> {
  if (!COMPRESSIBLE.includes(file.type) || file.size <= LEAVE_ALONE_BELOW) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return file;

    // A transparent PNG would turn black as a JPEG.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}
