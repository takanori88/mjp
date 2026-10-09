import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { installInputGuards } from "./input";
import { createDocumentRenderer, externalUrl, type Snapshot } from "./render";
import "./style.css";

const article = document.querySelector<HTMLElement>("#document")!;
const status = document.querySelector<HTMLElement>("#status")!;
installInputGuards(article, window);

const render = createDocumentRenderer(
  article, status, import.meta.env.VITE_MJP_PERF === "1" ? perf : undefined,
);

let requestNumber = 0;

function perf(stage: string): void {
  if (import.meta.env.VITE_MJP_PERF === "1") {
    void invoke("perf_mark", { stage, renderedMs: performance.timeOrigin + performance.now() });
  }
}

async function load(): Promise<void> {
  const number = ++requestNumber;
  try {
    const snapshot = await invoke<Snapshot>("get_document");
    perf("document_received");
    if (number === requestNumber) render(snapshot);
  } catch (error) {
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
    void invoke("close_preview");
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
      void invoke("close_preview");
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
  if (url) void invoke("open_external", { url });
});

await listen("document-changed", () => { void load(); });
await load();
