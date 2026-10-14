export function installInputGuards(article: HTMLElement, host: Window): void {
  const { Element } = article.ownerDocument.defaultView!;
  article.addEventListener("auxclick", event => {
    const target = event.target;
    if (target instanceof Element && target.closest("a[href]")) event.preventDefault();
  });
  for (const type of ["dragover", "drop"]) {
    host.addEventListener(type, event => event.preventDefault());
  }
}
