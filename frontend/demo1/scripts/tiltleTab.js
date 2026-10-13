const DEFAULT_PLOTS = [
  { id: "plot-scatterplot-matrix", title: "Scatterplot Matrix" }
];

export function createTitleTab(plots = DEFAULT_PLOTS) {
  const nav = document.createElement("nav");
  nav.className = "title-tab";
  nav.setAttribute("aria-label", "Plot navigation");

  const list = document.createElement("ul");
  list.className = "title-tab-list";

  const buttons = new Map();
  let activeId = plots[0]?.id ?? null;
  let scrollingToId = null;

  function setActive(id) {
    activeId = id;
    for (const [plotId, button] of buttons) {
      const isActive = plotId === id;
      button.classList.toggle("title-tab-item-active", isActive);
      if (isActive) {
        button.setAttribute("aria-current", "true");
      } else {
        button.removeAttribute("aria-current");
      }
    }
  }

  function scrollToPlot(id) {
    const target = document.getElementById(id);
    if (!target) {
      return;
    }

    scrollingToId = id;
    setActive(id);
    target.scrollIntoView({ behavior: "smooth", block: "start" });

    window.setTimeout(() => {
      if (scrollingToId === id) {
        scrollingToId = null;
      }
    }, 600);
  }

  for (const plot of plots) {
    const item = document.createElement("li");
    item.className = "title-tab-entry";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "title-tab-item";
    button.textContent = plot.title;
    button.addEventListener("click", () => scrollToPlot(plot.id));

    buttons.set(plot.id, button);
    item.appendChild(button);
    list.appendChild(item);
  }

  nav.appendChild(list);

  const observer = new IntersectionObserver((entries) => {
    if (scrollingToId) {
      return;
    }

    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

    if (visible[0]) {
      setActive(visible[0].target.id);
    }
  }, {
    rootMargin: "-15% 0px -55% 0px",
    threshold: [0, 0.25, 0.5, 1]
  });

  requestAnimationFrame(() => {
    for (const plot of plots) {
      const section = document.getElementById(plot.id);
      if (section) {
        observer.observe(section);
      }
    }
  });

  if (activeId) {
    setActive(activeId);
  }

  return nav;
}

export function createPlotSection({ id, title, node }) {
  const section = document.createElement("section");
  section.id = id;
  section.className = "plot-section";
  section.setAttribute("aria-label", title);
  section.appendChild(node);
  return section;
}
