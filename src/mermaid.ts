import mermaid from "mermaid";
import type { RenderDiagram } from "./diagrams.ts";

type DiagramApi = {
  initialize: typeof mermaid.initialize;
  render: (id: string, source: string, container: HTMLElement) => Promise<{ svg: string }>;
};

let nextId = 0;

export function createMermaidRenderer(api: DiagramApi, document: Document): RenderDiagram {
  return async (source, dark) => {
    const container = document.createElement("div");
    // Hidden layout retains text measurements that display:none would discard.
    container.style.cssText = "position: absolute; left: -10000px; top: 0; visibility: hidden";
    document.body.append(container);
    try {
      api.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: dark ? "dark" : "default",
        suppressErrorRendering: true,
      });
      const { svg } = await api.render(`mjp-mermaid-${++nextId}`, source, container);
      return svg;
    } finally {
      container.remove();
    }
  };
}

export const renderMermaid = createMermaidRenderer(mermaid, document);
