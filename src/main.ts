import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
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

const markdown = new MarkdownIt({ html: false, breaks: false }).use(taskLists);
markdown.renderer.rules.image = (tokens, index) =>
  markdown.utils.escapeHtml(tokens[index].content);
for (const [name, language] of Object.entries({
  bash, css, diff, go, javascript, json, python, rust, typescript, xml,
})) {
  hljs.registerLanguage(name, language);
}
hljs.registerAliases(["sh", "shell", "zsh"], { languageName: "bash" });
hljs.registerAliases(["js"], { languageName: "javascript" });
hljs.registerAliases(["ts"], { languageName: "typescript" });
hljs.registerAliases(["html", "svg"], { languageName: "xml" });

let lastRevision = -1;
let lastText: string | null = null;
let requestNumber = 0;

function perf(stage: string): void {
  if (import.meta.env.VITE_MDQ_PERF === "1") {
    void invoke("perf_mark", { stage, renderedMs: performance.timeOrigin + performance.now() });
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
  for (const code of article.querySelectorAll<HTMLElement>("pre code")) {
    const language = [...code.classList]
      .find((name) => name.startsWith("language-"))
      ?.slice("language-".length);
    if (!language || !hljs.getLanguage(language)) continue;
    code.innerHTML = hljs.highlight(code.textContent ?? "", {
      language,
      ignoreIllegals: true,
    }).value;
    code.classList.add("hljs");
  }
  lastText = snapshot.text;
  perf("highlight_done");
  window.scrollTo(0, scrollY);

  if (import.meta.env.VITE_MDQ_PERF === "1" && lastRevision === 0) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      perf("first_render");
    }));
  } else if (import.meta.env.VITE_MDQ_PERF === "1") {
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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" || (event.metaKey && event.key.toLowerCase() === "w")) {
    event.preventDefault();
    void invoke("close_preview");
  }
});

article.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor) return;
  event.preventDefault();
  const href = anchor.getAttribute("href");
  if (!href) return;
  try {
    const url = new URL(href);
    if (["https:", "http:", "mailto:"].includes(url.protocol)) {
      void invoke("open_external", { url: url.href });
    }
  } catch {
    // Relative links have no useful destination in a single-file preview.
  }
});

await listen("document-changed", () => { void load(); });
await load();
