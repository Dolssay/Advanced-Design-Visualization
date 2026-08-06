const TOOL_OPTIONS = [
  { id: "move", label: "Move", cursor: "grab" },
  { id: "select", label: "Select", cursor: "default" },
  { id: "zoom-in", label: "Zoom In", cursor: "zoom-in" },
  { id: "zoom-out", label: "Zoom Out", cursor: "zoom-out" },
  { id: "lasso", label: "Lasso", cursor: "crosshair" },
  { id: "brush", label: "Brush", cursor: "cell" }
];

export function createToolController() {
  const state = {
    tool: "move",
    tooltipCursor: true,
    tooltipPinned: true,
    linking: false
  };

  const listeners = new Set();
  const globalPins = new Set();
  const localPinsByPlot = new Map();
  const eventLog = [];

  function emit(event) {
    eventLog.push(event);
    for (const listener of listeners) {
      listener(event);
    }
  }

  function getLocalPins(plotId) {
    let pins = localPinsByPlot.get(plotId);
    if (!pins) {
      pins = new Set();
      localPinsByPlot.set(plotId, pins);
    }
    return pins;
  }

  function getTargetPins(plotId) {
    return state.linking ? globalPins : getLocalPins(plotId);
  }

  return {
    state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getTool() {
      return state.tool;
    },
    getTooltipMode() {
      return state.tooltipCursor || state.tooltipPinned ? "on" : "off";
    },
    isTooltipEnabled() {
      return state.tooltipCursor || state.tooltipPinned;
    },
    getTooltipTargets() {
      return {
        cursor: state.tooltipCursor,
        pinned: state.tooltipPinned
      };
    },
    isLinkingEnabled() {
      return state.linking;
    },
    setTool(tool) {
      if (state.tool === tool) return;
      state.tool = tool;
      emit({ type: "tool", tool });
    },
    setTooltipMode(mode) {
      const next = mode === "on";
      if (state.tooltipCursor === next && state.tooltipPinned === next) return;
      state.tooltipCursor = next;
      state.tooltipPinned = next;
      emit({ type: "tooltipMode", mode: next ? "on" : "off" });
    },
    setTooltipTargets(targets) {
      const nextCursor = Boolean(targets?.cursor);
      const nextPinned = Boolean(targets?.pinned);
      if (state.tooltipCursor === nextCursor && state.tooltipPinned === nextPinned) return;
      state.tooltipCursor = nextCursor;
      state.tooltipPinned = nextPinned;
      emit({
        type: "tooltipMode",
        mode: nextCursor || nextPinned ? "on" : "off",
        cursor: nextCursor,
        pinned: nextPinned
      });
    },
    setLinking(linking) {
      if (state.linking === linking) return;
      state.linking = linking;
      emit({ type: "linking", linking });
    },
    togglePin(plotId, pointId, append = false) {
      const pins = getTargetPins(plotId);
      if (!append) {
        pins.clear();
        pins.add(pointId);
        emit({ type: "pins", plotId });
        return;
      }

      if (pins.has(pointId)) {
        pins.delete(pointId);
      } else {
        pins.add(pointId);
      }
      emit({ type: "pins", plotId });
    },
    addPins(plotId, pointIds) {
      const pins = getTargetPins(plotId);
      let changed = false;
      for (const pointId of pointIds) {
        if (!pins.has(pointId)) {
          pins.add(pointId);
          changed = true;
        }
      }
      if (changed) {
        emit({ type: "pins", plotId });
      }
    },
    clearPins(plotId) {
      const pins = getTargetPins(plotId);
      if (pins.size) {
        pins.clear();
        emit({ type: "pins", plotId });
      }
    },
    clearAllPins() {
      globalPins.clear();
      localPinsByPlot.clear();
      emit({ type: "pins" });
    },
    getPinnedIds(plotId) {
      const pins = new Set(globalPins);
      const localPins = localPinsByPlot.get(plotId);
      if (localPins) {
        for (const pinId of localPins) {
          pins.add(pinId);
        }
      }
      return pins;
    },
    getEventLog() {
      return eventLog.slice();
    },
    emit(event) {
      emit(event);
    },
    createSelectionOverlay(container) {
      const overlay = document.createElement("div");
      overlay.className = "plot-selection-overlay is-hidden";
      container.appendChild(overlay);
      return overlay;
    }
  };
}

export function createToolsBar(controller) {
  const root = document.createElement("div");
  root.className = "tools-root";

  const title = document.createElement("div");
  title.className = "tools-title";
  title.textContent = "Tools";

  const left = document.createElement("div");
  left.className = "tools-left";

  const right = document.createElement("div");
  right.className = "tools-right";

  const buttons = new Map();

  for (const tool of TOOL_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tool-button";
    button.textContent = tool.label;
    button.title = tool.label;
    button.dataset.tool = tool.id;
    button.dataset.cursor = tool.cursor;
    button.addEventListener("click", () => controller.setTool(tool.id));
    buttons.set(tool.id, button);
    left.appendChild(button);
  }

  const tooltipField = document.createElement("div");
  tooltipField.className = "tool-field";
  const tooltipLabel = document.createElement("label");
  tooltipLabel.textContent = "Tooltips";
  const tooltipToggle = document.createElement("input");
  tooltipToggle.type = "checkbox";
  tooltipToggle.title = "Enable or disable tooltips";
  const tooltipDetails = document.createElement("details");
  tooltipDetails.className = "tool-details";
  const tooltipSummary = document.createElement("summary");
  tooltipSummary.textContent = "▾";
  const tooltipMenu = document.createElement("div");
  tooltipMenu.className = "tool-menu";
  const cursorTooltipLabel = document.createElement("label");
  cursorTooltipLabel.className = "tool-switch";
  const cursorTooltipInput = document.createElement("input");
  cursorTooltipInput.type = "checkbox";
  const cursorTooltipText = document.createElement("span");
  cursorTooltipText.textContent = "Cursor tooltip";
  cursorTooltipLabel.append(cursorTooltipInput, cursorTooltipText);
  const pinnedTooltipLabel = document.createElement("label");
  pinnedTooltipLabel.className = "tool-switch";
  const pinnedTooltipInput = document.createElement("input");
  pinnedTooltipInput.type = "checkbox";
  const pinnedTooltipText = document.createElement("span");
  pinnedTooltipText.textContent = "Chosen points";
  pinnedTooltipLabel.append(pinnedTooltipInput, pinnedTooltipText);
  tooltipMenu.append(cursorTooltipLabel, pinnedTooltipLabel);
  tooltipDetails.append(tooltipSummary, tooltipMenu);
  tooltipToggle.addEventListener("change", () => {
    const enabled = tooltipToggle.checked;
    if (!enabled) {
      controller.setTooltipTargets({ cursor: false, pinned: false });
      return;
    }
    const current = controller.getTooltipTargets();
    if (!current.cursor && !current.pinned) {
      controller.setTooltipTargets({ cursor: true, pinned: true });
    }
  });
  cursorTooltipInput.addEventListener("change", () => {
    controller.setTooltipTargets({
      cursor: cursorTooltipInput.checked,
      pinned: pinnedTooltipInput.checked
    });
  });
  pinnedTooltipInput.addEventListener("change", () => {
    controller.setTooltipTargets({
      cursor: cursorTooltipInput.checked,
      pinned: pinnedTooltipInput.checked
    });
  });
  tooltipField.append(tooltipLabel, tooltipToggle, tooltipDetails);

  const linkingField = document.createElement("label");
  linkingField.className = "tool-switch";
  const linkingInput = document.createElement("input");
  linkingInput.type = "checkbox";
  linkingInput.addEventListener("change", () => controller.setLinking(linkingInput.checked));
  const linkingText = document.createElement("span");
  linkingText.textContent = "Linking";
  linkingField.append(linkingInput, linkingText);

  right.append(tooltipField, linkingField);
  root.append(title, left, right);

  const updateActive = () => {
    for (const [toolId, button] of buttons.entries()) {
      button.dataset.active = String(controller.getTool() === toolId);
    }
    const tooltipTargets = controller.getTooltipTargets();
    tooltipToggle.checked = tooltipTargets.cursor || tooltipTargets.pinned;
    cursorTooltipInput.checked = tooltipTargets.cursor;
    pinnedTooltipInput.checked = tooltipTargets.pinned;
    linkingInput.checked = controller.isLinkingEnabled();
  };

  updateActive();
  controller.subscribe((event) => {
    if (event.type === "tool" || event.type === "tooltipMode" || event.type === "linking") {
      updateActive();
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    root.dataset.compact = String(root.offsetWidth < 920);
  });
  resizeObserver.observe(root);
  queueMicrotask(() => {
    root.dataset.compact = String(root.offsetWidth < 920);
  });

  return root;
}
