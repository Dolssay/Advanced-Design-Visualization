const TOOL_OPTIONS = [
  { id: "move", label: "Move", cursor: "grab" },
  { id: "zoom-in", label: "Zoom In", cursor: "zoom-in" },
  { id: "zoom-out", label: "Zoom Out", cursor: "zoom-out" },
  { id: "lasso", label: "Lasso", cursor: "crosshair" },
  { id: "brush", label: "Brush", cursor: "cell" }
];

export function createToolController() {
  const state = {
    tool: "move",
    moveSelect: true,
    tooltipCursor: true,
    tooltipPinned: true,
    linking: false,
    highlightedPointId: null,
    pinnedHighlightedPointIds: new Set()
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
    isMoveSelectEnabled() {
      return state.moveSelect;
    },
    setTool(tool) {
      if (state.tool === tool) return;
      state.tool = tool;
      emit({ type: "tool", tool });
    },
    setMoveSelect(moveSelect) {
      if (state.moveSelect === moveSelect) return;
      state.moveSelect = moveSelect;
      emit({ type: "moveSelect", moveSelect });
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
    setHighlightedPointId(pointId) {
      if (state.highlightedPointId === pointId) return;
      state.highlightedPointId = pointId ?? null;
      emit({ type: "highlightedPoint", pointId: state.highlightedPointId });
    },
    clearHighlightedPointId() {
      if (state.highlightedPointId === null) return;
      state.highlightedPointId = null;
      emit({ type: "highlightedPoint", pointId: null });
    },
    getHighlightedPointId() {
      return state.highlightedPointId;
    },
    getHighlightedPointIds() {
      const highlightedPointIds = new Set(state.pinnedHighlightedPointIds);
      if (state.highlightedPointId) {
        highlightedPointIds.add(state.highlightedPointId);
      }
      return highlightedPointIds;
    },
    isPinnedHighlightedPoint(pointId) {
      return state.pinnedHighlightedPointIds.has(pointId);
    },
    togglePinnedHighlightedPoint(pointId) {
      if (!pointId) return;
      if (state.pinnedHighlightedPointIds.has(pointId)) {
        state.pinnedHighlightedPointIds.delete(pointId);
      } else {
        state.pinnedHighlightedPointIds.add(pointId);
      }
      emit({ type: "pinnedHighlight", pointId });
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
    removePin(pointId) {
      if (!pointId) return;
      let changed = globalPins.delete(pointId);
      for (const pins of localPinsByPlot.values()) {
        changed = pins.delete(pointId) || changed;
      }
      changed = state.pinnedHighlightedPointIds.delete(pointId) || changed;
      if (state.highlightedPointId === pointId) {
        state.highlightedPointId = null;
        emit({ type: "highlightedPoint", pointId: null });
      }
      if (changed) {
        emit({ type: "pins" });
        emit({ type: "pinnedHighlight", pointId });
      }
    },
    clearAllPins() {
      globalPins.clear();
      localPinsByPlot.clear();
      state.highlightedPointId = null;
      state.pinnedHighlightedPointIds.clear();
      emit({ type: "pins" });
      emit({ type: "highlightedPoint", pointId: null });
      emit({ type: "pinnedHighlight" });
    },
    getAllPinnedIds() {
      const pins = new Set(globalPins);
      for (const localPins of localPinsByPlot.values()) {
        for (const pinId of localPins) {
          pins.add(pinId);
        }
      }
      return pins;
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
  const dropdownDetails = new Set();

  function closeDropdowns(except = null) {
    for (const details of dropdownDetails) {
      if (details !== except) {
        details.open = false;
      }
    }
  }

  for (const tool of TOOL_OPTIONS) {
    if (tool.id === "move") {
      const moveDetails = document.createElement("details");
      moveDetails.className = "tool-details tool-button-dropdown";
      const moveSummary = document.createElement("summary");
      moveSummary.className = "tool-button tool-button-summary";
      moveSummary.title = tool.label;
      moveSummary.dataset.tool = tool.id;
      moveSummary.dataset.cursor = tool.cursor;
      const moveText = document.createElement("span");
      moveText.textContent = tool.label;
      const moveArrow = document.createElement("span");
      moveArrow.className = "tool-button-arrow";
      moveArrow.textContent = "▾";
      moveSummary.append(moveText, moveArrow);
      const moveMenu = document.createElement("div");
      moveMenu.className = "tool-menu";
      const moveSelectLabel = document.createElement("label");
      moveSelectLabel.className = "tool-switch";
      const moveSelectInput = document.createElement("input");
      moveSelectInput.type = "checkbox";
      moveSelectInput.dataset.moveSelect = "true";
      const moveSelectText = document.createElement("span");
      moveSelectText.textContent = "Select points";
      moveSelectLabel.append(moveSelectInput, moveSelectText);
      moveMenu.append(moveSelectLabel);
      moveDetails.append(moveSummary, moveMenu);
      dropdownDetails.add(moveDetails);
      buttons.set(tool.id, moveSummary);
      moveSummary.addEventListener("click", () => {
        closeDropdowns(moveDetails);
        controller.setTool(tool.id);
      });
      moveSelectInput.addEventListener("change", () => {
        controller.setTool("move");
        controller.setMoveSelect(moveSelectInput.checked);
      });
      left.appendChild(moveDetails);
      continue;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "tool-button";
    button.textContent = tool.label;
    button.title = tool.label;
    button.dataset.tool = tool.id;
    button.dataset.cursor = tool.cursor;
    button.addEventListener("click", () => {
      closeDropdowns();
      controller.setTool(tool.id);
    });
    buttons.set(tool.id, button);
    left.appendChild(button);
  }

  const tooltipField = document.createElement("div");
  tooltipField.className = "tool-switch tool-switch-menu";
  const tooltipToggle = document.createElement("input");
  tooltipToggle.type = "checkbox";
  tooltipToggle.title = "Enable or disable tooltips";
  const tooltipLabel = document.createElement("span");
  const tooltipDetails = document.createElement("details");
  tooltipDetails.className = "tool-details";
  const tooltipSummary = document.createElement("summary");
  tooltipSummary.className = "tool-menu-button";
  const tooltipSummaryText = document.createElement("span");
  tooltipSummaryText.textContent = "Tooltips";
  tooltipSummary.append(tooltipSummaryText);
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
  dropdownDetails.add(tooltipDetails);
  tooltipSummary.addEventListener("click", () => {
    closeDropdowns(tooltipDetails);
  });
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
  tooltipField.append(tooltipToggle, tooltipLabel, tooltipDetails);

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

  document.addEventListener("click", (event) => {
    if (!root.contains(event.target)) {
      closeDropdowns();
    }
  });

  const updateActive = () => {
    for (const [toolId, button] of buttons.entries()) {
      button.dataset.active = String(controller.getTool() === toolId);
    }
    const tooltipTargets = controller.getTooltipTargets();
    tooltipToggle.checked = tooltipTargets.cursor || tooltipTargets.pinned;
    cursorTooltipInput.checked = tooltipTargets.cursor;
    pinnedTooltipInput.checked = tooltipTargets.pinned;
    const moveSelectInput = root.querySelector("[data-move-select]");
    if (moveSelectInput) {
      moveSelectInput.checked = controller.isMoveSelectEnabled();
    }
    linkingInput.checked = controller.isLinkingEnabled();
  };

  updateActive();
  controller.subscribe((event) => {
    if (event.type === "tool" || event.type === "moveSelect" || event.type === "tooltipMode" || event.type === "linking") {
      if (event.type === "tool" && event.tool !== "move") {
        closeDropdowns();
      }
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
