const TOOL_OPTIONS = [
  { id: "move", label: "Move", cursor: "grab" },
  { id: "select", label: "Select", cursor: "default" },
  { id: "zoom-in", label: "Zoom In", cursor: "zoom-in" },
  { id: "zoom-out", label: "Zoom Out", cursor: "zoom-out" },
  { id: "lasso", label: "Lasso", cursor: "crosshair" },
  { id: "brush", label: "Brush", cursor: "cell" }
];

function createStyleElement() {
  const style = document.createElement("style");
  style.textContent = `
    .tools-root {
      display: flex;
      align-items: stretch;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border: 1px solid #cfcfcf;
      border-radius: 12px;
      background: linear-gradient(180deg, #fafafa 0%, #f2f2f2 100%);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
      min-height: 64px;
      width: 100%;
      box-sizing: border-box;
    }
    .tools-title {
      font-family: "Times New Roman", serif;
      font-weight: 700;
      font-size: 20px;
      line-height: 1;
      color: #222;
      display: flex;
      align-items: center;
      padding-right: 8px;
      border-right: 1px solid #d8d8d8;
    }
    .tools-left,
    .tools-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .tools-block {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .tool-button {
      border: 1px solid #bfbfbf;
      background: #fff;
      color: #222;
      border-radius: 8px;
      padding: 8px 12px;
      font: inherit;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, transform 0.08s ease;
    }
    .tool-button:hover {
      background: #f4f4f4;
    }
    .tool-button:active {
      transform: translateY(1px);
    }
    .tool-button[data-active="true"] {
      background: #1f2937;
      border-color: #111827;
      color: #fff;
    }
    .tool-field {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border: 1px solid #d1d1d1;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.8);
      color: #222;
      font: inherit;
    }
    .tool-field label {
      font-size: 13px;
      font-weight: 600;
    }
    .tool-select {
      border: 1px solid #c7c7c7;
      border-radius: 8px;
      padding: 6px 8px;
      font: inherit;
      background: #fff;
      color: #222;
    }
    .tool-switch {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border: 1px solid #c7c7c7;
      border-radius: 10px;
      background: #fff;
      color: #222;
      font-size: 13px;
      font-weight: 600;
    }
    .tool-switch input {
      width: 16px;
      height: 16px;
      margin: 0;
    }
    .tool-details {
      position: relative;
    }
    .tool-details summary {
      list-style: none;
      cursor: pointer;
      user-select: none;
    }
    .tool-details summary::-webkit-details-marker {
      display: none;
    }
    .tool-menu {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      min-width: 190px;
      padding: 10px;
      border: 1px solid #d1d1d1;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
      z-index: 10;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .tools-root[data-compact="true"] {
      flex-direction: column;
      align-items: stretch;
    }
    .tools-root[data-compact="true"] .tools-title {
      border-right: 0;
      border-bottom: 1px solid #d8d8d8;
      padding-right: 0;
      padding-bottom: 8px;
    }
    .tools-root[data-compact="true"] .tools-left,
    .tools-root[data-compact="true"] .tools-right {
      justify-content: flex-start;
    }
  `;
  return style;
}

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
      overlay.style.position = "absolute";
      overlay.style.display = "none";
      overlay.style.border = "1px dashed #4a90e2";
      overlay.style.background = "rgba(74, 144, 226, 0.12)";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "2";
      overlay.style.boxSizing = "border-box";
      container.appendChild(overlay);
      return overlay;
    }
  };
}

export function createToolsBar(controller) {
  document.head.appendChild(createStyleElement());

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
