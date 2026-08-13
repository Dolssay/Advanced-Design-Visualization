export function createContentController(data) {
  const listeners = new Set();
  const labels = [];
  const seen = new Set();

  for (const row of data) {
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

export function createContentBox(controller) {
  const root = document.createElement("aside");
  root.className = "contentbox-root";

  const title = document.createElement("div");
  title.className = "contentbox-title";
  title.textContent = "Content";

  const filterSection = document.createElement("details");
  filterSection.className = "contentbox-section";
  filterSection.open = true;

  const filterSummary = document.createElement("summary");
  filterSummary.className = "contentbox-section-summary";
  const arrow = document.createElement("span");
  arrow.textContent = "▾";
  const summaryText = document.createElement("span");
  summaryText.textContent = "Filter";
  const summaryCount = document.createElement("span");
  summaryCount.className = "contentbox-summary-count";
  filterSummary.append(summaryText, summaryCount, arrow);

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

    for (const label of controller.getLabels()) {
      const item = document.createElement("label");
      item.className = "contentbox-label-item";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = controller.isLabelSelected(label);

      const text = document.createElement("span");
      text.textContent = label;

      input.addEventListener("change", () => {
        controller.setLabelSelected(label, input.checked);
      });

      item.append(input, text);
      labelNodes.set(label, input);
      labelList.appendChild(item);
    }

    summaryCount.textContent = `${controller.getSelectedLabels().size}/${controller.getLabels().length}`;
  }

  clearButton.addEventListener("click", () => controller.clearAll());
  refreshButton.addEventListener("click", () => controller.refreshAll());

  filterMenu.append(helperText, buttonRow, labelList);
  filterSection.append(filterSummary, filterMenu);
  root.append(title, filterSection);

  controller.subscribe((event) => {
    if (event.type === "labels") {
      for (const [label, input] of labelNodes.entries()) {
        input.checked = controller.isLabelSelected(label);
      }
      summaryCount.textContent = `${controller.getSelectedLabels().size}/${controller.getLabels().length}`;
    }
  });

  renderLabels();
  return root;
}
