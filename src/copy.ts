export type WriteText = (text: string) => Promise<void>;

// Tabs and line breaks are the only controls a code block displays. Joiners, variation
// selectors, and bidirectional formatting stay because emoji, Persian and Indic scripts,
// ideographic variants, and right-to-left text look different without them.
const hiddenCharacters =
  /(?![\t\n\u061C\u180B-\u180D\u180F\u200C-\u200F\u202A-\u202E\u2066-\u2069\uFE00-\uFE0F\u{E0100}-\u{E01EF}])[\p{Cc}\p{Default_Ignorable_Code_Point}]/gu;

// Path data is embedded from @primer/octicons 19.41.0 (copy-16, check-16, x-16) instead of
// adding an icon dependency. MIT License, Copyright (c) 2026 GitHub Inc.; see docs/en/THIRD_PARTY.md.
// The two copy-16 paths do not overlap, so they share one path element.
const iconPaths = {
  copy: "M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" +
    "M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z",
  success: "M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z",
  error: "M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z",
};

export function addCodeCopyButtons(article: HTMLElement, writeText: WriteText): () => void {
  const document = article.ownerDocument;
  const view = document.defaultView!;
  const timers = new Set<number>();
  let disposed = false;
  let index = 0;
  for (const code of article.querySelectorAll<HTMLElement>("pre > code[data-mjp-fence]")) {
    const pre = code.parentElement!;
    const block = document.createElement("div");
    block.className = "code-block";
    const actions = document.createElement("div");
    actions.className = "code-actions";
    const feedback = document.createElement("span");
    feedback.className = "copy-feedback";
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    feedback.setAttribute("aria-atomic", "true");
    feedback.setAttribute("aria-label", `Code block ${++index} copy status`);
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `Copy code block ${index}`);
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("width", "16");
    icon.setAttribute("height", "16");
    icon.setAttribute("fill", "currentColor");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    icon.append(path);
    button.append(icon);
    const tooltip = document.createElement("span");
    tooltip.className = "copy-tooltip";
    tooltip.id = `mjp-copy-tooltip-${index}`;
    tooltip.setAttribute("role", "tooltip");
    button.setAttribute("aria-describedby", tooltip.id);
    actions.append(button, tooltip, feedback);
    pre.replaceWith(block);
    block.append(actions, pre);

    function setState(state: "idle" | "pending" | "success" | "error", message: string): void {
      button.dataset.state = state;
      path.setAttribute("d", iconPaths[state === "success" || state === "error" ? state : "copy"]);
      tooltip.textContent = message;
      feedback.textContent = state === "idle" ? "" : message;
    }
    setState("idle", "Copy code to clipboard");
    let pending = false;
    let resetTimer: number | undefined;
    button.addEventListener("click", async () => {
      if (disposed || pending) return;
      if (resetTimer !== undefined) {
        view.clearTimeout(resetTimer);
        timers.delete(resetTimer);
        resetTimer = undefined;
      }
      pending = true;
      button.setAttribute("aria-disabled", "true");
      setState("pending", "Copying…");
      try {
        const text = code.textContent ?? "";
        const shown = text.replace(hiddenCharacters, "");
        await writeText(shown);
        if (!disposed) {
          setState("success", shown === text ? "Copied" : "Copied without hidden characters");
          resetTimer = view.setTimeout(() => {
            timers.delete(resetTimer!);
            resetTimer = undefined;
            if (!disposed) setState("idle", "Copy code to clipboard");
          }, 2000);
          timers.add(resetTimer);
        }
      } catch {
        if (!disposed) setState("error", "Copy failed. Try again.");
      } finally {
        pending = false;
        if (!disposed) button.removeAttribute("aria-disabled");
      }
    });
  }
  return () => {
    disposed = true;
    for (const timer of timers) view.clearTimeout(timer);
    timers.clear();
  };
}
