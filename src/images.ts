export type ImageReference = { source: string; alt: string; title: string | null };
export type ReadImage = (reference: string) => Promise<ArrayBuffer>;

export const MAX_IMAGES = 64;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_IMAGE_BYTES = 32 * 1024 * 1024;

export function isLocalImage(source: string): boolean {
  try {
    const path = decodeURIComponent(source.split(/[?#]/, 1)[0]);
    return path.length > 0 && !path.startsWith("/") && !/[:\\\x00-\x1f\x7f]/.test(path);
  } catch {
    return false;
  }
}

function imageType(bytes: Uint8Array): string | null {
  const starts = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte);
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return "image/png";
  if (starts(255, 216, 255)) return "image/jpeg";
  if (starts(71, 73, 70, 56, 55, 97) || starts(71, 73, 70, 56, 57, 97)) return "image/gif";
  if (starts(82, 73, 70, 70) && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) {
    return "image/webp";
  }
  return null;
}

export function loadImages(
  article: HTMLElement,
  references: ImageReference[],
  read: ReadImage,
): () => void {
  const document = article.ownerDocument;
  const view = document.defaultView!;
  const urls = new Map<string, string>();
  let active = true;
  let totalBytes = 0;
  let budgetExceeded = false;

  const pending = [...article.querySelectorAll<HTMLElement>("[data-mjp-image]")];
  async function load(): Promise<void> {
    for (const placeholder of pending) {
      if (!active) return;
      const reference = references[Number(placeholder.dataset.mjpImage)];
      if (!reference) continue;
      try {
        let url = urls.get(reference.source);
        if (!url) {
          if (budgetExceeded) throw new Error("Document image size limit exceeded");
          const buffer = await read(reference.source);
          if (!active) return;
          if (buffer.byteLength > MAX_IMAGE_BYTES || totalBytes + buffer.byteLength > MAX_DOCUMENT_IMAGE_BYTES) {
            budgetExceeded = totalBytes + buffer.byteLength > MAX_DOCUMENT_IMAGE_BYTES;
            throw new Error("Image size limit exceeded");
          }
          const type = imageType(new Uint8Array(buffer));
          if (!type) throw new Error("Unsupported image format");
          totalBytes += buffer.byteLength;
          url = view.URL.createObjectURL(new view.Blob([buffer], { type }));
          urls.set(reference.source, url);
        }
        const image = document.createElement("img");
        image.alt = reference.alt;
        if (reference.title !== null) image.title = reference.title;
        image.decoding = "async";
        image.loading = "lazy";
        image.addEventListener("error", () => {
          if (!active) return;
          placeholder.textContent = reference.alt || "Image unavailable";
          placeholder.title = "Cannot display this image";
        }, { once: true });
        image.src = url;
        placeholder.replaceChildren(image);
      } catch (error) {
        if (!active) return;
        placeholder.title = `Image unavailable: ${String(error)}`;
      }
    }
  }
  void load();
  return () => {
    active = false;
    for (const url of urls.values()) view.URL.revokeObjectURL(url);
    urls.clear();
  };
}
