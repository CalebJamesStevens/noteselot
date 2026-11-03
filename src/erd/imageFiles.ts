/** Images are embedded in the shared diagram so JSON export/import remains portable. */
export const MAX_IMAGE_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_DATA_CHARS = 220_000;
export const MAX_DIAGRAM_IMAGE_CHARS = 600_000;
export const MAX_DIAGRAM_IMAGES = 8;
export const IMAGE_INPUT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export async function optimizeDiagramImage(file: File): Promise<string> {
  if (!IMAGE_INPUT_TYPES.includes(file.type as (typeof IMAGE_INPUT_TYPES)[number])) {
    throw new Error("Choose a PNG, JPEG, or WebP image. SVG and other formats aren't supported.");
  }
  if (!file.size || file.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error("Choose an image smaller than 8 MB.");
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 90_000_000) {
      throw new Error("Image dimensions are too large or invalid.");
    }
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image encoding isn't supported in this browser.");
    const baseScale = Math.min(1, 1600 / image.naturalWidth, 1200 / image.naturalHeight);
    for (let step = 0; step < 6; step++) {
      const scale = baseScale * Math.pow(0.8, step);
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.7, 0.53, 0.38]) {
        let data = canvas.toDataURL("image/webp", quality);
        if (!data.startsWith("data:image/webp;base64,")) {
          // Older browsers without WebP encoding, preserving safe JPEG output.
          context.globalCompositeOperation = "destination-over";
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.globalCompositeOperation = "source-over";
          data = canvas.toDataURL("image/jpeg", quality);
        }
        if (data.length <= MAX_IMAGE_DATA_CHARS) return data;
      }
    }
    throw new Error("This image is too detailed to fit in a shared diagram. Crop it or use a smaller image.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
