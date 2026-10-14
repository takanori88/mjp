import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import { highlightCode, highlighter } from "./highlight.ts";
import { isLocalImage, loadImages, MAX_IMAGES, type ImageReference, type ReadImage } from "./images.ts";

export type Snapshot = {
  text: string;
  error: string | null;
  warning: string | null;
  revision: number;
};

const markdown = new MarkdownIt({ html: false, breaks: false }).use(taskLists);
markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  const alt = renderer.renderInlineAsText(token.children ?? [], options, env);
  const source = String(token.attrGet("src") ?? "");
  const references = env?.images as ImageReference[] | undefined;
  if (!references || !isLocalImage(source) || references.length >= MAX_IMAGES) return markdown.utils.escapeHtml(alt);
  const title = token.attrGet("title");
  const imageIndex = references.push({ source, alt, title: title === null ? null : String(title) }) - 1;
  return `<span data-mjp-image="${imageIndex}">${markdown.utils.escapeHtml(alt || "Image")}</span>`;
};

export const MAX_MARKDOWN_BYTES = 128 * 1024;

export function externalUrl(anchor: HTMLAnchorElement): string | null {
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

export function createDocumentRenderer(
  article: HTMLElement,
  status: HTMLElement,
  mark?: (stage: string) => void,
  readImage?: ReadImage,
): (snapshot: Snapshot) => void {
  const view = article.ownerDocument.defaultView!;
  let lastRevision = -1;
  let lastText: string | null = null;
  let lastPlainText = false;
  let disposeImages = () => {};
  view.addEventListener("pagehide", () => disposeImages());
  return function render(snapshot: Snapshot): void {
    if (snapshot.revision < lastRevision) return;
    lastRevision = snapshot.revision;
    const plainText = snapshot.text === lastText ? lastPlainText :
      snapshot.text.length > MAX_MARKDOWN_BYTES ||
      new TextEncoder().encode(snapshot.text).byteLength > MAX_MARKDOWN_BYTES;
    const notice = plainText ? "This document is larger than 128 KiB and is shown as plain text." : null;
    const message = snapshot.error ?? snapshot.warning ?? notice;
    status.hidden = !message;
    status.textContent = message ?? "";

    if (snapshot.text === lastText) return;
    disposeImages();
    const scrollY = view.scrollY;
    if (plainText) {
      const pre = article.ownerDocument.createElement("pre");
      pre.textContent = snapshot.text;
      article.replaceChildren(pre);
      mark?.("dom_inserted");
    } else {
      const images: ImageReference[] = [];
      const raw = markdown.render(snapshot.text, { images });
      mark?.("markdown_parsed");
      article.innerHTML = DOMPurify.sanitize(raw, {
        FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "img", "svg"],
        FORBID_ATTR: ["style"],
      });
      mark?.("dom_inserted");
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
      if (readImage) disposeImages = loadImages(article, images, readImage);
    }
    lastPlainText = plainText;
    lastText = snapshot.text;
    mark?.("highlight_done");
    view.scrollTo(0, scrollY);

    if (mark) {
      const stage = snapshot.revision === 0 ? "first_render" : "reload_render";
      view.requestAnimationFrame(() => view.requestAnimationFrame(() => mark(stage)));
    }
  };
}
