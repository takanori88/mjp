import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { startPreview } from "./preview.ts";
import "./style.css";

await startPreview(
  document.querySelector<HTMLElement>("#document")!,
  document.querySelector<HTMLElement>("#status")!,
  {
    getDocument: () => invoke("get_document"),
    getImage: reference => invoke<ArrayBuffer>("get_image", { reference }),
    subscribe: changed => getCurrentWebviewWindow().listen("document-changed", () => { void changed(); }),
    close: () => invoke("close_preview"),
    openExternal: url => invoke("open_external", { url }),
    writeText: text => navigator.clipboard.writeText(text),
    mark: import.meta.env.VITE_MJP_PERF === "1"
      ? stage => {
        void invoke("perf_mark", { stage, renderedMs: performance.timeOrigin + performance.now() });
      }
      : undefined,
  },
);
