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

for (const [name, language] of Object.entries({
  bash, css, diff, go, javascript, json, python, rust, typescript, xml,
})) {
  hljs.registerLanguage(name, language);
}
hljs.registerAliases(["sh", "shell", "zsh"], { languageName: "bash" });
hljs.registerAliases(["js"], { languageName: "javascript" });
hljs.registerAliases(["ts"], { languageName: "typescript" });
hljs.registerAliases(["html", "svg"], { languageName: "xml" });

export const highlighter = hljs;

export function highlightCode(
  code: HTMLElement,
  language: string,
  highlight: (text: string, language: string) => string = (text, language) =>
    hljs.highlight(text, { language, ignoreIllegals: true }).value,
): void {
  const fragment = DOMPurify.sanitize(highlight(code.textContent ?? "", language), {
    ALLOWED_TAGS: ["span"],
    ALLOWED_ATTR: ["class"],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  for (const span of fragment.querySelectorAll("span[class]")) {
    // Nested scopes and embedded languages use names without the hljs prefix.
    const classes = [...span.classList].filter(name =>
      /^(?:hljs-[a-z][a-z0-9_-]*|language-[a-z][a-z0-9-]*|[a-z][a-z0-9_-]*_+)$/.test(name),
    );
    if (classes.length) span.setAttribute("class", classes.join(" "));
    else span.removeAttribute("class");
  }
  code.replaceChildren(fragment);
  code.classList.add("hljs");
}
