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
  loadSearch?: () => Promise<typeof import("./search.ts")>;
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
  let search: ReturnType<typeof import("./search.ts")["createSearch"]> | undefined;
  let searchLoading: Promise<void> | undefined;
  let searchWanted = false;
  let disposed = false;

  function openSearch(): void {
    if (disposed) return;
    searchWanted = true;
    if (search) {
      search.open();
      return;
    }
    searchLoading ??= Promise.resolve().then(() => bridge.loadSearch?.() ?? import("./search.ts")).then(module => {
      if (disposed) return;
      search = module.createSearch(article, { status });
      if (searchWanted) search.open();
    }).catch(error => {
      if (disposed) return;
      searchLoading = undefined;
      searchWanted = false;
      status.hidden = false;
      status.textContent = `Cannot open search: ${String(error)}`;
    });
  }

  window.addEventListener("pagehide", () => {
    disposed = true;
    searchWanted = false;
    search?.dispose();
  });

  async function load(): Promise<void> {
    const number = ++requestNumber;
    try {
      const snapshot = await bridge.getDocument();
      bridge.mark?.("document_received");
      if (number === requestNumber && render(snapshot)) search?.documentReplaced();
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
    if (
      (event.metaKey && event.key.toLowerCase() === "w") ||
      (event.key === "Escape" && !search?.isOpen && !search?.isShown && !searchWanted)
    ) {
      event.preventDefault();
      firstGAt = 0;
      void bridge.close();
      return;
    }

    if (event.defaultPrevented) {
      firstGAt = 0;
      return;
    }

    if (event.key === "Escape") {
      firstGAt = 0;
      if (event.isComposing) return;
      event.preventDefault();
      searchWanted = false;
      search?.close();
      return;
    }

    if (event.isComposing) {
      firstGAt = 0;
      return;
    }

    if (event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      firstGAt = 0;
      openSearch();
      return;
    }

    if (
      search?.isOpen && event.target === search.input && event.key === "Enter" &&
      !event.metaKey && !event.altKey && !event.ctrlKey
    ) {
      event.preventDefault();
      firstGAt = 0;
      if (search.commit() !== "empty") searchWanted = false;
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
      case "/":
        event.preventDefault();
        openSearch();
        break;
      case "n":
      case "N":
        if (!search?.isOpen && search?.move(event.key === "n" ? 1 : -1)) event.preventDefault();
        break;
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
