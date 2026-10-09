import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import DOMPurify from "dompurify";
import { highlightCode, highlighter } from "./highlight";
import { installInputGuards } from "./input";
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import "./style.css";

type Snapshot = {
  text: string;
  error: string | null;
  warning: string | null;
  revision: number;
};

const article = document.querySelector<HTMLElement>("#document")!;
const status = document.querySelector<HTMLElement>("#status")!;
installInputGuards(article, window);

const markdown = new MarkdownIt({ html: false, breaks: false }).use(taskLists);
markdown.renderer.rules.image = (tokens, index) =>
  markdown.utils.escapeHtml(tokens[index].content);

let lastRevision = -1;
let lastText: string | null = null;
let requestNumber = 0;

function perf(stage: string): void {
  if (import.meta.env.VITE_MJP_PERF === "1") {
    void invoke("perf_mark", { stage, renderedMs: performance.timeOrigin + performance.now() });
  }
}

function externalUrl(anchor: HTMLAnchorElement): string | null {
  const href = anchor.getAttribute("href");
  if (!href) return null;
  try {
    const url = new URL(href);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    // Relative links have no useful destination in a single-file preview.
    return null;
  }
}

function render(snapshot: Snapshot): void {
  if (snapshot.revision < lastRevision) return;
  lastRevision = snapshot.revision;
  const message = snapshot.error ?? snapshot.warning;
  status.hidden = !message;
  status.textContent = message ?? "";

  if (snapshot.text === lastText) return;
  const scrollY = window.scrollY;
  const raw = markdown.render(snapshot.text);
  perf("markdown_parsed");
  article.innerHTML = DOMPurify.sanitize(raw, {
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "img", "svg"],
    FORBID_ATTR: ["style"],
  });
  perf("dom_inserted");
  for (const anchor of article.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const url = externalUrl(anchor);
    if (!url) continue;
    const title = anchor.getAttribute("title");
    anchor.setAttribute("title", title === null ? url : `${url}\n${title}`);
  }
  for (const code of article.querySelectorAll<HTMLElement>("pre code")) {
    const language = [...code.classList]
      .find((name) => name.startsWith("language-"))
      ?.slice("language-".length);
    if (!language || !highlighter.getLanguage(language)) continue;
    highlightCode(code, language);
  }
  lastText = snapshot.text;
  perf("highlight_done");
  window.scrollTo(0, scrollY);

  if (import.meta.env.VITE_MJP_PERF === "1" && lastRevision === 0) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      perf("first_render");
    }));
  } else if (import.meta.env.VITE_MJP_PERF === "1") {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      perf("reload_render");
    }));
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
