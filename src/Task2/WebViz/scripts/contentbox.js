function parsePointId(pointId) {
  const match = /^point-(\d+)$/.exec(pointId ?? "");
  return match ? Number(match[1]) : null;
}

function formatPointDetails(row) {
  if (!row) {
    return "";
  }

  return [
    `Label: ${row.Label ?? ""}`,
    `OEW (1000 lbm): ${row["OEW (1000 lbm)"] ?? ""}`,
    `Block Fuel (1000 lbm): ${row["Block Fuel (1000 lbm)"] ?? ""}`,
    `Cruise CD (count): ${row["Cruise CD (count)"] ?? ""}`
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
        index: index ?? row.__rowId + 1
      };
    },
    getPointDetails(pointId) {
      const row = this.getRowByPointId(pointId);
      return formatPointDetails(row);
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
  helperText.textContent = "Toggle labels to filter the matrix.";

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

  const highlightDescription = document.createElement("div");
  highlightDescription.className = "contentbox-helper";
  highlightDescription.textContent = "Manage Highlighted Points";

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
  highlightHeader.append(highlightTitle, highlightDescription, highlightActions);

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
    highlightList.replaceChildren();

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
      body.textContent = contentController.getPointDetails(point.id);
      body.hidden = !(expandAllEnabled || expandedPointIds.has(point.id));

      summary.append(number, label, actions);
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
    if (event.type === "pins") {
      renderHighlights();
    }
  });

  renderLabels();
  renderHighlights();
  setTab(activeTab);

  return root;
}
