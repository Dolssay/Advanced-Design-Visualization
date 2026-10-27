// The reasons banner at the top of the panel: one item per cause, with the fix
// buttons. Items come from bannerItems() in feasibilityModel.js; this file only
// renders them. The <ul> keeps aria-live="polite", so screen readers hear the
// same reasons the shading shows.
//
// Items are keyed by id and only rebuilt when their content changes: slices
// stream in one by one and each redraws the banner, so swapping every node
// would replace a "Move to" button between the user's mousedown and mouseup.

import { el } from "./format.js";

export function createFeasibilityBanner(list, { onFix }) {
  const nodes = new Map(); // id -> { li, signature }

  function build(item) {
    return el("li", { class: `banner-item is-${item.kind}`, "data-id": item.id }, [
      item.lead ? el("strong", { text: `${item.lead} ` }) : null,
      item.text,
      item.fixes.length ? el("div", { class: "banner-fixes" }, item.fixes.map((fix) => el("button", {
        class: "btn btn-small", type: "button", text: fix.button,
        onclick: () => onFix({ [fix.key]: fix.value })
      }))) : null
    ]);
  }

  function render(items) {
    const next = items.map((item) => {
      const signature = JSON.stringify(item);
      const existing = nodes.get(item.id);
      if (existing && existing.signature === signature) return existing.li;
      const li = build(item);
      nodes.set(item.id, { li, signature });
      return li;
    });
    for (const id of [...nodes.keys()]) if (!items.some((i) => i.id === id)) nodes.delete(id);
    // Patch in place: a node that is unchanged and already in position is never
    // detached, so a button being clicked keeps its identity through a redraw.
    next.forEach((node, i) => {
      const at = list.children[i];
      if (at === node) return;
      if (at && !next.includes(at)) at.replaceWith(node);
      else list.insertBefore(node, at || null);
    });
    while (list.children.length > next.length) list.lastElementChild.remove();
  }

  return { render };
}
