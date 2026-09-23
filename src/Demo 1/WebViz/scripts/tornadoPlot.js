import { createGTB777ProfilerModel } from "./profilerGTB777.js";

const DESIGN_VARIABLES = [
  {
    key: "ARHT",
    label: "ARHT",
    min: 3.70,
    baseline: 4.62,
    max: 5.54
  },
  {
    key: "TRHT",
    label: "TRHT",
    min: 0.26,
    baseline: 0.33,
    max: 0.40
  },
  {
    key: "TCHT",
    label: "TCHT",
    min: 0.071,
    baseline: 0.088,
    max: 0.106
  },
  {
    key: "SWPHT (deg)",
    label: "SWPHT (deg)",
    min: 27.86,
    baseline: 34.82,
    max: 41.78
  },
  {
    key: "SHT (sqft)",
    label: "SHT (sqft)",
    min: 895.4,
    baseline: 1119,
    max: 1343
  },
  {
    // Dataset uses ETAIE; paper calls this ETAEI.
    key: "ETAIE",
    label: "ETAEI",
    min: 0,
    baseline: 0,
    max: 0.20
  },
  {
    // Dataset uses ETAOE; paper calls this ETAEO.
    key: "ETAOE",
    label: "ETAEO",
    min: 0.80,
    baseline: 0.93,
    max: 1.00
  },
  {
    key: "CRE",
    label: "CRE",
    min: 0.233,
    baseline: 0.291,
    max: 0.350
  }
];

const OBJECTIVES = [
  {
    key: "Cruise CD (count)",
    label: "Cruise CD",
    unit: "counts"
  },
  {
    key: "OEW (1000 lbm)",
    label: "OEW",
    unit: "1000 lbm"
  },
  {
    key: "Block Fuel (1000 lbm)",
    label: "Block Fuel",
    unit: "1000 lbm"
  }
];

// Fit a fresh model when the label filter narrows the data. Cached by the
// label selection so toggling objectives does not refit.
const MIN_ROWS_FOR_FIT = DESIGN_VARIABLES.length + 2;

function baselineValues() {
  const values = {};
  for (const variable of DESIGN_VARIABLES) {
    values[variable.key] = variable.baseline;
  }
  return values;
}

// True one-at-a-time sensitivity: every variable is swept to its min and max
// while all others stay at baseline, using the jointly fitted model shared
// with the Prediction Profiler. A per-variable univariate slope would instead
// absorb the effect of any correlated variable (e.g. SHT leaking into ETAEI).
function calculateSensitivity(model, objectiveKey) {
  const baseline = baselineValues();
  const baselinePrediction = model.predict(objectiveKey, baseline);

  const variables = DESIGN_VARIABLES
    .map((variable) => {
      const lowPrediction = model.predict(objectiveKey, {
        ...baseline,
        [variable.key]: variable.min
      });

      const highPrediction = model.predict(objectiveKey, {
        ...baseline,
        [variable.key]: variable.max
      });

      const lowImpact = lowPrediction - baselinePrediction;
      const highImpact = highPrediction - baselinePrediction;

      return {
        ...variable,
        lowPrediction,
        highPrediction,
        lowImpact,
        highImpact,
        magnitude: Math.max(
          Math.abs(lowImpact),
          Math.abs(highImpact)
        )
      };
    })
    .sort((a, b) => b.magnitude - a.magnitude);

  return { baselinePrediction, variables };
}

function formatSigned(value) {
  const text = Math.abs(value) < 5e-5 ? "0.0000" : value.toFixed(4);
  return value > 0 && text !== "0.0000" ? `+${text}` : text;
}

export function createTornadoPlot(
  data,
  contentController = null,
  sharedModel = null
) {
  const width = 900;
  const height = 520;

  const margin = {
    top: 35,
    right: 80,
    bottom: 65,
    left: 150
  };

  const innerWidth =
    width - margin.left - margin.right;

  const innerHeight =
    height - margin.top - margin.bottom;

  const root = document.createElement("div");
  root.className = "tornado-container";

  const header = document.createElement("div");
  header.className = "tornado-header";

  const title = document.createElement("div");
  title.className = "tornado-title";
  title.textContent = "GTB777 Tornado Plot";

  const subtitle = document.createElement("div");
  subtitle.className = "tornado-subtitle";
  subtitle.textContent =
    "Model-based one-at-a-time sensitivity of the selected objective to each design variable.";

  header.append(title, subtitle);

  const controls = document.createElement("div");
  controls.className = "tornado-controls";

  const objectiveLabel =
    document.createElement("label");

  objectiveLabel.className =
    "tornado-control-label";

  objectiveLabel.textContent = "Objective:";

  const objectiveSelect =
    document.createElement("select");

  objectiveSelect.className =
    "tornado-objective-select";

  for (const objective of OBJECTIVES) {
    const option =
      document.createElement("option");

    option.value = objective.key;
    option.textContent = objective.label;

    objectiveSelect.appendChild(option);
  }

  controls.append(
    objectiveLabel,
    objectiveSelect
  );

  const chartContainer =
    document.createElement("div");

  chartContainer.className = "tornado-chart";

  const svg = d3
    .select(chartContainer)
    .append("svg")
    .attr("class", "tornado-svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr(
      "aria-label",
      "GTB777 tornado sensitivity plot"
    );

  const chart = svg
    .append("g")
    .attr(
      "transform",
      `translate(${margin.left},${margin.top})`
    );

  const tooltip =
    document.createElement("div");

  tooltip.className = "tornado-tooltip";
  tooltip.style.display = "none";

  root.append(
    header,
    controls,
    chartContainer,
    tooltip
  );

  const modelCache = new Map();

  function getVisibleData() {
    if (contentController) {
      return contentController.getFilteredData(data);
    }

    return data;
  }

  function isFilterActive() {
    if (!contentController) {
      return false;
    }

    return (
      contentController.getSelectedLabels().size !==
      contentController.getLabels().length
    );
  }

  // Unfiltered: reuse the Prediction Profiler's model so both plots agree.
  // Filtered: refit on the selected labels so the bars describe that subset.
  function getModel(visibleData) {
    const cacheKey = isFilterActive()
      ? [...contentController.getSelectedLabels()].sort().join("|")
      : "__all__";

    if (modelCache.has(cacheKey)) {
      return modelCache.get(cacheKey);
    }

    let model = null;

    if (cacheKey === "__all__" && sharedModel) {
      model = sharedModel;
    } else if (visibleData.length >= MIN_ROWS_FOR_FIT) {
      try {
        model = createGTB777ProfilerModel(visibleData);
      } catch (error) {
        console.warn("Tornado plot: model fit failed.", error);
      }
    }

    modelCache.set(cacheKey, model);
    return model;
  }

  function render() {
    // Remove old legend before drawing a new one.
    svg.selectAll(".tornado-legend").remove();

    const objectiveKey = objectiveSelect.value;

    const objective =
      OBJECTIVES.find(
        (item) => item.key === objectiveKey
      ) || OBJECTIVES[0];

    const visibleData = getVisibleData();

    chart.selectAll("*").remove();

    const model = getModel(visibleData);

    if (!model) {
      chart
        .append("text")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight / 2)
        .attr("text-anchor", "middle")
        .attr("class", "tornado-empty")
        .text(
          visibleData.length
            ? `Too few designs to fit a model (${visibleData.length}; need ${MIN_ROWS_FOR_FIT}).`
            : "No data available for the current filter."
        );

      subtitle.textContent =
        `${visibleData.length.toLocaleString()} designs analyzed — ${objective.label} sensitivity.`;

      return;
    }

    const {
      baselinePrediction,
      variables: sensitivity
    } = calculateSensitivity(model, objective.key);

    const r2 = model.getR2?.(objective.key);

    const allImpacts =
      sensitivity.flatMap((variable) => [
        variable.lowImpact,
        variable.highImpact,
        0
      ]);

    let minImpact = d3.min(allImpacts);
    let maxImpact = d3.max(allImpacts);

    if (minImpact === maxImpact) {
      minImpact -= 1;
      maxImpact += 1;
    }

    const padding =
      (maxImpact - minImpact) * 0.08;

    const x = d3
      .scaleLinear()
      .domain([
        minImpact - padding,
        maxImpact + padding
      ])
      .nice()
      .range([0, innerWidth]);

    const y = d3
      .scaleBand()
      .domain(
        sensitivity.map(
          (variable) => variable.label
        )
      )
      .range([0, innerHeight])
      .padding(0.25);

    const zeroX = x(0);

    chart
      .append("g")
      .attr("class", "tornado-grid")
      .call(
        d3
          .axisBottom(x)
          .tickSize(innerHeight)
          .tickFormat("")
      )
      .select(".domain")
      .remove();

    chart
      .append("line")
      .attr("class", "tornado-zero-line")
      .attr("x1", zeroX)
      .attr("x2", zeroX)
      .attr("y1", 0)
      .attr("y2", innerHeight);

    const rows = chart
      .selectAll(".tornado-row")
      .data(sensitivity)
      .join("g")
      .attr("class", "tornado-row")
      .attr(
        "transform",
        (variable) =>
          `translate(0,${y(variable.label)})`
      );

    const halfHeight =
      y.bandwidth() / 2;

    rows
      .append("rect")
      .attr(
        "class",
        "tornado-bar tornado-bar-low"
      )
      .attr("x", (variable) =>
        Math.min(
          zeroX,
          x(variable.lowImpact)
        )
      )
      .attr("y", 0)
      .attr("width", (variable) =>
        Math.abs(
          x(variable.lowImpact) - zeroX
        )
      )
      .attr("height", halfHeight);

    rows
      .append("rect")
      .attr(
        "class",
        "tornado-bar tornado-bar-high"
      )
      .attr("x", (variable) =>
        Math.min(
          zeroX,
          x(variable.highImpact)
        )
      )
      .attr("y", halfHeight)
      .attr("width", (variable) =>
        Math.abs(
          x(variable.highImpact) - zeroX
        )
      )
      .attr("height", halfHeight);

    rows
      .on(
        "mouseenter",
        function (event, variable) {
          tooltip.style.display = "block";

          tooltip.innerHTML = `
            <strong>${variable.label}</strong><br>
            Minimum: ${variable.min}<br>
            Baseline: ${variable.baseline}<br>
            Maximum: ${variable.max}<br>
            Low impact: ${formatSigned(variable.lowImpact)} ${objective.unit}<br>
            High impact: ${formatSigned(variable.highImpact)} ${objective.unit}<br>
            <span class="tornado-tooltip-note">${objective.label} at min / baseline / max:
            ${variable.lowPrediction.toFixed(2)} / ${baselinePrediction.toFixed(2)} / ${variable.highPrediction.toFixed(2)}</span>
          `;
        }
      )
      .on("mousemove", function (event) {
        const rootBounds =
          root.getBoundingClientRect();

        tooltip.style.left =
          `${
            event.clientX -
            rootBounds.left +
            12
          }px`;

        tooltip.style.top =
          `${
            event.clientY -
            rootBounds.top +
            12
          }px`;
      })
      .on("mouseleave", function () {
        tooltip.style.display = "none";
      });

    chart
      .append("g")
      .attr("class", "tornado-y-axis")
      .call(
        d3
          .axisLeft(y)
          .tickSize(0)
      )
      .call((axis) =>
        axis.select(".domain").remove()
      );

    chart
      .append("g")
      .attr("class", "tornado-x-axis")
      .attr(
        "transform",
        `translate(0,${innerHeight})`
      )
      .call(
        d3
          .axisBottom(x)
          .ticks(7)
      );

    chart
      .append("text")
      .attr(
        "class",
        "tornado-axis-label"
      )
      .attr("x", innerWidth / 2)
      .attr("y", innerHeight + 50)
      .attr("text-anchor", "middle")
      .text(
        `Predicted change in ${objective.label} (${objective.unit}) from baseline, other variables held at baseline`
      );

    const legend = svg
      .append("g")
      .attr(
        "class",
        "tornado-legend"
      )
      .attr(
        "transform",
        `translate(${
          margin.left +
          innerWidth -
          250
        },15)`
      );

    legend
      .append("rect")
      .attr(
        "class",
        "tornado-legend-low"
      )
      .attr("width", 14)
      .attr("height", 14);

    legend
      .append("text")
      .attr("x", 20)
      .attr("y", 12)
      .text("Variable minimum");

    legend
      .append("rect")
      .attr(
        "class",
        "tornado-legend-high"
      )
      .attr("x", 135)
      .attr("width", 14)
      .attr("height", 14);

    legend
      .append("text")
      .attr("x", 155)
      .attr("y", 12)
      .text("Variable maximum");

    const fitNote = Number.isFinite(r2)
      ? ` · fit R² = ${r2.toFixed(4)}`
      : "";

    const scopeNote = isFilterActive()
      ? " (model refit on selected labels)"
      : "";

    subtitle.textContent =
      `${visibleData.length.toLocaleString()} designs analyzed${scopeNote} — ` +
      `${objective.label} sensitivity around baseline ` +
      `${baselinePrediction.toFixed(2)} ${objective.unit}${fitNote}.`;
  }

  objectiveSelect.addEventListener(
    "change",
    render
  );

  if (contentController) {
    contentController.subscribe((event) => {
      if (event.type === "labels") {
        render();
      }
    });
  }

  render();

  return root;
}
