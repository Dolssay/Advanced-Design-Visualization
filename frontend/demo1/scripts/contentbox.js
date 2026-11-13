import { getGTB777SketchColor } from "./sketchGTB777.js";
import { DIMENSIONS, formatDimensionTitle } from "./gtb777Dimensions.js";

function parsePointId(pointId) {
  const match = /^point-(\d+)$/.exec(pointId ?? "");
  return match ? Number(match[1]) : null;
}

// The short form (outputs only) is the pinned tooltip on small plots; the Content box
// details list the design's input parameters as well.
function formatPointDetails(row, withInputs = false) {
  if (!row) {
    return "";
  }

  const lines = (group) => DIMENSIONS
    .filter((dimension) => dimension.group === group)
    .map((dimension) => `${formatDimensionTitle(dimension)}: ${row[dimension.key] ?? ""}`);

  if (!withInputs) {
    return [`Label: ${row.Label ?? ""}`, ...lines("output")].join("\n");
  }

  return [
    `Label: ${row.Label ?? ""}`,
    "",
    "Inputs",
    ...lines("input"),
    "",
    "Outputs",
    ...lines("output")
  ].join("\n");
}

export function createContentController(data) {
  const listeners = new Set();
  const labels = [];
  const seen = new Set();
  const rowsById = new Map();

  for (const row of data) {
    rowsById.set(row.__rowId, row);
    const label = row.Label ?? "";
    if (seen.has(label)) {
      continue;
    }
    seen.add(label);
    labels.push(label);
  }

  const state = {
    labels,
    selectedLabels: new Set(labels)
  };

  function emit(event) {
    for (const listener of listeners) {
      listener(event);
    }
  }

  function setSelectedLabels(selectedLabels) {
    const next = new Set(selectedLabels);
    const changed = next.size !== state.selectedLabels.size
      || labels.some((label) => next.has(label) !== state.selectedLabels.has(label));

    if (!changed) {
      return;
    }

    state.selectedLabels = next;
    emit({ type: "labels" });
  }

  return {
    state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getLabels() {
      return [...state.labels];
    },
    getRows() {
      return [...rowsById.values()];
    },
    getSelectedLabels() {
      return new Set(state.selectedLabels);
    },
    isLabelSelected(label) {
      return state.selectedLabels.has(label);
    },
    getFilteredData(dataRows) {
      if (!state.selectedLabels.size) {
        return [];
      }
      return dataRows.filter((row) => state.selectedLabels.has(row.Label ?? ""));
    },
    getRowByPointId(pointId) {
      const rowId = parsePointId(pointId);
      return rowId == null ? null : rowsById.get(rowId) ?? null;
    },
    getPointSummary(pointId, index = null) {
      const row = this.getRowByPointId(pointId);
      if (!row) {
        return null;
      }
      return {
        id: pointId,
        rowId: row.__rowId,
        label: row.Label ?? "",
        title: formatPointDetails(row),
        row,
        index: index ?? row.__rowId + 1
      };
    },
    getPointDetails(pointId) {
      const row = this.getRowByPointId(pointId);
      return formatPointDetails(row, true);
    },
    getPinnedPointSummaries(plotController) {
      const ids = Array.from(plotController?.getAllPinnedIds?.() ?? []);
      return ids
        .map((pointId) => this.getPointSummary(pointId))
        .filter(Boolean)
        .sort((a, b) => a.rowId - b.rowId)
        .map((point, index) => ({
          ...point,
          index: index + 1
        }));
    },
    getDrawnPointSummaries(plotController) {
      const ids = Array.from(plotController?.getDrawnPointIds?.() ?? []);
      return ids
        .map((pointId) => this.getPointSummary(pointId))
        .filter(Boolean)
        .sort((a, b) => a.rowId - b.rowId)
        .map((point, index) => ({
          ...point,
          drawColorIndex: plotController?.getDrawnPointColorIndex?.(point.id) ?? index,
          index: index + 1
        }));
    },
    setLabelSelected(label, selected) {
      const next = new Set(state.selectedLabels);
      if (selected) {
        next.add(label);
      } else {
        next.delete(label);
      }
      setSelectedLabels(next);
    },
    clearAll() {
      if (!state.selectedLabels.size) {
        return;
      }
      state.selectedLabels = new Set();
      emit({ type: "labels" });
    },
    refreshAll() {
      setSelectedLabels(state.labels);
    }
  };
}

export function createContentBox(contentController, plotController) {
  const root = document.createElement("aside");
  root.className = "contentbox-root";

  const title = document.createElement("div");
  title.className = "contentbox-title";
  title.textContent = "Content";

  const tabs = document.createElement("div");
  tabs.className = "contentbox-tabs";

  const filterTabButton = document.createElement("button");
  filterTabButton.type = "button";
  filterTabButton.className = "contentbox-tab";
  filterTabButton.textContent = "Filter";

  const highlightTabButton = document.createElement("button");
  highlightTabButton.type = "button";
  highlightTabButton.className = "contentbox-tab";
  highlightTabButton.textContent = "Highlight Points";

  tabs.append(filterTabButton, highlightTabButton);

  const panels = document.createElement("div");
  panels.className = "contentbox-panels";

  const filterPanel = document.createElement("section");
  filterPanel.className = "contentbox-panel";

  const filterSection = document.createElement("details");
  filterSection.className = "contentbox-section";
  filterSection.open = true;

  const filterSummary = document.createElement("summary");
  filterSummary.className = "contentbox-section-summary";
  const summaryText = document.createElement("span");
  summaryText.textContent = "Filter";
  const summaryCount = document.createElement("span");
  summaryCount.className = "contentbox-summary-count";
  filterSummary.append(summaryText, summaryCount);

  const filterMenu = document.createElement("div");
  filterMenu.className = "contentbox-menu";

  const helperText = document.createElement("div");
  helperText.className = "contentbox-helper";
  helperText.textContent = "Toggle labels to filter every linked plot: matrix, parallel coordinates, tornado, box & violin, and heatmap.";

  const buttonRow = document.createElement("div");
  buttonRow.className = "contentbox-actions";

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "contentbox-button";
  clearButton.textContent = "Clear All";

  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.className = "contentbox-button contentbox-button-primary";
  refreshButton.textContent = "Refresh";

  buttonRow.append(clearButton, refreshButton);

  const labelList = document.createElement("div");
  labelList.className = "contentbox-label-list";
  const labelNodes = new Map();

  function renderLabels() {
    labelList.replaceChildren();
    labelNodes.clear();

    for (const label of contentController.getLabels()) {
      const item = document.createElement("label");
      item.className = "contentbox-label-item";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = contentController.isLabelSelected(label);

      const text = document.createElement("span");
      text.textContent = label;

      input.addEventListener("change", () => {
        contentController.setLabelSelected(label, input.checked);
      });

      item.append(input, text);
      labelNodes.set(label, input);
      labelList.appendChild(item);
    }

    summaryCount.textContent = `${contentController.getSelectedLabels().size}/${contentController.getLabels().length}`;
  }

  clearButton.addEventListener("click", () => contentController.clearAll());
  refreshButton.addEventListener("click", () => contentController.refreshAll());

  filterMenu.append(helperText, buttonRow, labelList);
  filterSection.append(filterSummary, filterMenu);
  filterPanel.append(filterSection);

  const highlightPanel = document.createElement("section");
  highlightPanel.className = "contentbox-panel";

  const highlightHeader = document.createElement("div");
  highlightHeader.className = "contentbox-highlight-header";

  const highlightTitle = document.createElement("div");
  highlightTitle.className = "contentbox-highlight-title";
  highlightTitle.textContent = "Manage Highlighted Points";

  const drawnCounter = document.createElement("div");
  drawnCounter.className = "contentbox-highlight-drawn-counter";

  const highlightActions = document.createElement("div");
  highlightActions.className = "contentbox-actions";

  const expandAllButton = document.createElement("button");
  expandAllButton.type = "button";
  expandAllButton.className = "contentbox-button contentbox-button-icon";
  expandAllButton.textContent = "\u22EE";
  expandAllButton.title = "Expand or collapse all point details";
  expandAllButton.setAttribute("aria-label", "Expand or collapse all point details");

  const clearPinsButton = document.createElement("button");
  clearPinsButton.type = "button";
  clearPinsButton.className = "contentbox-button contentbox-button-primary";
  clearPinsButton.textContent = "Refresh";

  highlightActions.append(expandAllButton, clearPinsButton);
  highlightHeader.append(highlightTitle, drawnCounter, highlightActions);

  const highlightList = document.createElement("div");
  highlightList.className = "contentbox-highlight-list";

  const highlightEmpty = document.createElement("div");
  highlightEmpty.className = "contentbox-highlight-empty";
  highlightEmpty.textContent = "No points are highlighted yet.";

  const expandedPointIds = new Set();
  let expandAllEnabled = false;
  let activeTab = "filter";

  function setTab(tabName) {
    activeTab = tabName;
    filterTabButton.dataset.active = String(tabName === "filter");
    highlightTabButton.dataset.active = String(tabName === "highlight");
    filterPanel.hidden = tabName !== "filter";
    highlightPanel.hidden = tabName !== "highlight";
  }

  function updateExpandAllButton() {
    expandAllButton.dataset.active = String(expandAllEnabled);
  }

  function togglePointDetails(pointId, expanded) {
    if (expanded) {
      expandedPointIds.add(pointId);
    } else {
      expandedPointIds.delete(pointId);
    }
    renderHighlights();
  }

  function renderHighlights() {
    const points = contentController.getPinnedPointSummaries(plotController);
    const drawnPointIds = plotController?.getDrawnPointIds?.() ?? new Set();
    const drawnPoints = contentController.getDrawnPointSummaries(plotController);
    const drawnPointIndexes = new Map(drawnPoints.map((point, index) => [point.id, index]));
    const maxDrawnPoints = contentController.getLabels().length;
    highlightList.replaceChildren();
    drawnCounter.hidden = drawnPoints.length === 0;
    drawnCounter.textContent = `${drawnPoints.length}/${maxDrawnPoints} Drawn Points`;

    if (!points.length) {
      highlightList.appendChild(highlightEmpty);
      updateExpandAllButton();
      return;
    }

    for (const point of points) {
      const item = document.createElement("article");
      item.className = "contentbox-highlight-item";
      item.dataset.pointId = point.id;
      item.addEventListener("mouseenter", () => plotController?.setHighlightedPointId?.(point.id));
      item.addEventListener("mouseleave", () => plotController?.clearHighlightedPointId?.());

      const summary = document.createElement("div");
      summary.className = "contentbox-highlight-summary";

      const number = document.createElement("span");
      number.className = "contentbox-highlight-number";
      number.textContent = String(point.index);

      const label = document.createElement("span");
      label.className = "contentbox-highlight-label";
      label.textContent = point.label || "(blank)";

      const pinButton = document.createElement("button");
      pinButton.type = "button";
      pinButton.className = "contentbox-highlight-pin";
      pinButton.textContent = "Pin";
      pinButton.title = "Pin highlighted draw";
      pinButton.dataset.active = String(plotController?.isPinnedHighlightedPoint?.(point.id) ?? false);
      pinButton.setAttribute("aria-label", `Pin highlighted draw for point ${point.index}`);
      pinButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        plotController?.togglePinnedHighlightedPoint?.(point.id);
      });

      const drawButton = document.createElement("button");
      drawButton.type = "button";
      drawButton.className = "contentbox-highlight-draw";
      drawButton.textContent = "Draw";
      drawButton.title = "Draw aircraft sketch";
      drawButton.dataset.active = String(plotController?.isDrawnPoint?.(point.id) ?? false);
      if (drawnPointIndexes.has(point.id)) {
        drawButton.style.setProperty("--draw-color", getGTB777SketchColor(plotController?.getDrawnPointColorIndex?.(point.id) ?? drawnPointIndexes.get(point.id)));
      } else {
        drawButton.style.removeProperty("--draw-color");
      }
      drawButton.disabled = !drawnPointIds.has(point.id) && drawnPointIds.size >= maxDrawnPoints;
      drawButton.setAttribute("aria-label", `Draw aircraft sketch for point ${point.index}`);
      drawButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        plotController?.toggleDrawnPoint?.(point.id, maxDrawnPoints);
      });

      const actions = document.createElement("button");
      actions.type = "button";
      actions.className = "contentbox-highlight-toggle";
      actions.textContent = "\u22EE";
      actions.title = "Expand point details";
      actions.setAttribute("aria-label", `Expand details for highlighted point ${point.index}`);
      actions.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        togglePointDetails(point.id, !expandedPointIds.has(point.id));
      });

      const body = document.createElement("div");
      body.className = "contentbox-highlight-body";

      const details = document.createElement("div");
      details.className = "contentbox-highlight-details";
      details.textContent = contentController.getPointDetails(point.id);

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "contentbox-highlight-delete";
      deleteButton.textContent = "X";
      deleteButton.title = "Remove highlighted point";
      deleteButton.setAttribute("aria-label", `Remove highlighted point ${point.index}`);
      deleteButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        expandedPointIds.delete(point.id);
        plotController?.removePin?.(point.id);
      });

      body.append(details, deleteButton);
      body.hidden = !(expandAllEnabled || expandedPointIds.has(point.id));

      summary.append(number, label, drawButton, pinButton, actions);
      item.append(summary, body);
      highlightList.appendChild(item);
    }

    updateExpandAllButton();
  }

  expandAllButton.addEventListener("click", () => {
    expandAllEnabled = !expandAllEnabled;
    updateExpandAllButton();
    renderHighlights();
  });

  clearPinsButton.addEventListener("click", () => {
    plotController?.clearAllPins?.();
    plotController?.clearHighlightedPointId?.();
  });

  filterTabButton.addEventListener("click", () => setTab("filter"));
  highlightTabButton.addEventListener("click", () => setTab("highlight"));

  panels.append(filterPanel, highlightPanel);
  highlightPanel.append(highlightHeader, highlightList);
  root.append(title, tabs, panels);

  contentController.subscribe((event) => {
    if (event.type === "labels") {
      for (const [label, input] of labelNodes.entries()) {
        input.checked = contentController.isLabelSelected(label);
      }
      summaryCount.textContent = `${contentController.getSelectedLabels().size}/${contentController.getLabels().length}`;
    }
  });

  plotController?.subscribe?.((event) => {
    if (event.type === "pins" || event.type === "pinnedHighlight" || event.type === "drawPoints") {
      renderHighlights();
    }
  });

  renderLabels();
  renderHighlights();
  setTab(activeTab);

  return root;
}
