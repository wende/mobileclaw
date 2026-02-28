export function findSlideGrid(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el;
  while (node) {
    if (node.style?.gridTemplateRows) return node;
    node = node.parentElement;
  }
  return null;
}
