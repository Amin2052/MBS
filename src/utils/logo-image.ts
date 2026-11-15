// Prepares an uploaded logo for the company-logo frame.
//
// The frame is square (see `.logo-preview-box` in settings-category.css), so a
// wide or tall logo can never fill it edge-to-edge without being stretched.
// This scales the image down (never up) until it fits inside a square canvas,
// preserving its aspect ratio and centring it on a transparent background.
// The result therefore looks exactly like the review preview and what the
// print/PDF templates render -- no distortion, no surprise cropping.

export const LOGO_CANVAS_SIZE = 512;

/** Refuse absurd files before decoding them in the renderer. */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export interface PreparedLogo {
  /** Square PNG data URL, centred and aspect-correct. */
  dataUrl: string;
  originalWidth: number;
  originalHeight: number;
  /** Size drawn inside the square canvas (aspect preserved). */
  fittedWidth: number;
  fittedHeight: number;
}

export async function prepareLogoFile(
  file: File,
  canvasSize = LOGO_CANVAS_SIZE
): Promise<PreparedLogo> {

  if (!file.type.startsWith("image/")) {
    throw new Error("unsupported-type");
  }

  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("file-too-large");
  }

  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file);
  }
  catch {
    throw new Error("unreadable-image");
  }

  try {

    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;

    if (!originalWidth || !originalHeight) {
      throw new Error("unreadable-image");
    }

    const scale = Math.min(canvasSize / originalWidth, canvasSize / originalHeight, 1);
    const fittedWidth = Math.max(1, Math.round(originalWidth * scale));
    const fittedHeight = Math.max(1, Math.round(originalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = canvasSize;
    canvas.height = canvasSize;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("unreadable-image");
    }

    context.clearRect(0, 0, canvasSize, canvasSize);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      bitmap,
      Math.round((canvasSize - fittedWidth) / 2),
      Math.round((canvasSize - fittedHeight) / 2),
      fittedWidth,
      fittedHeight
    );

    return {
      dataUrl: canvas.toDataURL("image/png"),
      originalWidth,
      originalHeight,
      fittedWidth,
      fittedHeight
    };

  }
  finally {
    bitmap.close();
  }

}
