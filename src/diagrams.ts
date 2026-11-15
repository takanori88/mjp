import DOMPurify from "dompurify";

export type RenderDiagram = (source: string, dark: boolean) => Promise<string>;
export type LoadDiagramRenderer = () => Promise<RenderDiagram>;

export const MAX_DIAGRAMS = 20;
export const MAX_DIAGRAM_SOURCE = 50000;

export function isMermaidFence(info: string): boolean {
  return info.trim().split(/\s+/, 1)[0] === "mermaid";
}

function sanitizeDiagram(output: string): Element {
  const fragment = DOMPurify.sanitize(output, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_TAGS: ["foreignObject"],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ["a", "image", "feImage", "img", "video", "audio", "source", "iframe", "object", "embed", "form", "input", "button", "script"],
  });
  const svg = fragment.firstElementChild;
  if (fragment.children.length !== 1 || svg?.localName !== "svg" ||
    svg.namespaceURI !== "http://www.w3.org/2000/svg" ||
    [...fragment.childNodes].some(node => node !== svg && (node.nodeType !== 3 || node.textContent?.trim()))) {
    throw new Error("Expected one SVG diagram");
  }
  return svg;
}

export function createDiagramQueue(loadRenderer: LoadDiagramRenderer) {
  let queue = Promise.resolve();
  let loading: Promise<RenderDiagram> | undefined;

  return function renderDiagrams(
    article: HTMLElement,
    sources: readonly string[],
    onLayoutChange?: () => void,
  ): () => void {
    const document = article.ownerDocument;
    const view = document.defaultView!;
    const pending = [...article.querySelectorAll<HTMLElement>("[data-mjp-diagram]")];
    let active = true;

    function note(placeholder: HTMLElement, message: string): void {
      const element = document.createElement("p");
      element.className = "diagram-note";
      element.setAttribute("role", "note");
      element.textContent = message;
      placeholder.prepend(element);
    }

    async function run(): Promise<void> {
      for (const placeholder of pending) {
        if (!active) return;
        const index = Number(placeholder.dataset.mjpDiagram);
        const source = sources[index];
        if (source === undefined) continue;
        if (index >= MAX_DIAGRAMS) {
          note(placeholder, "Only the first 20 Mermaid diagrams are rendered.");
        } else if (source.length > MAX_DIAGRAM_SOURCE) {
          note(placeholder, "This Mermaid diagram is too large to render.");
        } else {
          try {
            loading ??= Promise.resolve().then(loadRenderer).catch(error => {
              loading = undefined;
              throw error;
            });
            const render = await loading;
            if (!active) return;
            const dark = view.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
            const output = await render(source, dark);
            if (!active) return;
            placeholder.replaceChildren(sanitizeDiagram(output));
          } catch (error) {
            if (!active) return;
            const message = error instanceof Error ? error.message : String(error);
            note(placeholder, `Cannot render this Mermaid diagram: ${message.split(/\r\n|[\r\n]/, 1)[0]}`);
          }
        }
        onLayoutChange?.();
      }
    }

    queue = queue.then(run).catch(() => {});
    return () => { active = false; };
  };
}
