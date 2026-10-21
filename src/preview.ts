import { installInputGuards } from "./input.ts";
import { createDocumentRenderer, externalUrl, type Snapshot } from "./render.ts";
import type { ReadImage } from "./images.ts";
import type { WriteText } from "./copy.ts";

type PreviewBridge = {
  getDocument: () => Promise<Snapshot>;
  getImage?: ReadImage;
  subscribe: (changed: () => Promise<void>) => Promise<unknown>;
  close: () => Promise<unknown>;
  openExternal: (url: string) => Promise<unknown>;
  writeText: WriteText;
  mark?: (stage: string) => void;
};

export async function startPreview(
  article: HTMLElement,
  status: HTMLElement,
  bridge: PreviewBridge,
): Promise<void> {
  const document = article.ownerDocument;
  const window = document.defaultView!;
  const { Element, performance } = window;
  const getComputedStyle = window.getComputedStyle.bind(window);
  installInputGuards(article, window);

  const render = createDocumentRenderer(
    article, status, bridge.mark, bridge.getImage, bridge.writeText,
  );

  let requestNumber = 0;

  async function load(): Promise<void> {
    const number = ++requestNumber;
    try {
      const snapshot = await bridge.getDocument();
      bridge.mark?.("document_received");
      if (number === requestNumber) render(snapshot);
    } catch (error) {
      if (number !== requestNumber) return;
      status.hidden = false;
      status.textContent = `Cannot display file: ${String(error)}`;
    }
  }

  let firstGAt = 0;
  const interactiveSelector =
    'button, input, select, textarea, [contenteditable], [role="textbox"], [role="combobox"], [role="searchbox"], [role="spinbutton"]';

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || (event.metaKey && event.key.toLowerCase() === "w")) {
      event.preventDefault();
      void bridge.close();
      return;
    }

    if (
      event.defaultPrevented || event.isComposing ||
      (event.target instanceof Element && event.target.closest(interactiveSelector)) ||
      event.metaKey || event.altKey
    ) {
      firstGAt = 0;
      return;
    }

    if (event.ctrlKey) {
      firstGAt = 0;
      if (event.shiftKey || (event.key !== "d" && event.key !== "u")) return;
      event.preventDefault();
      window.scrollBy(0, window.innerHeight * (event.key === "d" ? 0.5 : -0.5));
      return;
    }

    if (event.key === "g" && !event.repeat) {
      const now = performance.now();
      if (firstGAt > 0 && now - firstGAt < 1000) {
        event.preventDefault();
        window.scrollTo(0, 0);
        firstGAt = 0;
      } else {
        firstGAt = now;
      }
      return;
    }

    firstGAt = 0;
    switch (event.key) {
      case "j":
      case "k":
        event.preventDefault();
        window.scrollBy(
          0,
          Math.max(24, parseFloat(getComputedStyle(article).lineHeight) || 24) *
            (event.key === "j" ? 1 : -1),
        );
        break;
      case "G":
        event.preventDefault();
        window.scrollTo(0, document.documentElement.scrollHeight);
        break;
      case "q":
        event.preventDefault();
        void bridge.close();
        break;
    }
  });

  article.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor) return;
    event.preventDefault();
    const url = externalUrl(anchor);
    if (url) void bridge.openExternal(url);
  });

  await bridge.subscribe(load);
  await load();
}
