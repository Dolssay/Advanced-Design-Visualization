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
    label: "Cruise CD"
  },
  {
    key: "OEW (1000 lbm)",
    label: "OEW"
  },
  {
    key: "Block Fuel (1000 lbm)",
    label: "Block Fuel"
  }
];

function numericPairs(data, xKey, yKey) {
  return data
    .map((row) => ({
      x: Number(row[xKey]),
      y: Number(row[yKey])
    }))
    .filter(
      (point) =>
        Number.isFinite(point.x) &&
        Number.isFinite(point.y)
    );
}

function calculateSlope(data, xKey, yKey) {
  const pairs = numericPairs(data, xKey, yKey);

  if (pairs.length < 2) {
    return 0;
  }

  const meanX = d3.mean(pairs, (point) => point.x);
  const meanY = d3.mean(pairs, (point) => point.y);

  let numerator = 0;
  let denominator = 0;

  for (const point of pairs) {
    const dx = point.x - meanX;

    numerator += dx * (point.y - meanY);
    denominator += dx * dx;
  }

  return denominator === 0
    ? 0
    : numerator / denominator;
}

function calculateSensitivity(data, objectiveKey) {
  return DESIGN_VARIABLES
    .map((variable) => {
      const slope = calculateSlope(
        data,
        variable.key,
        objectiveKey
      );

      const lowImpact =
        slope * (variable.min - variable.baseline);

      const highImpact =
        slope * (variable.max - variable.baseline);

      return {
        ...variable,
        slope,
        lowImpact,
        highImpact,
        magnitude: Math.max(
          Math.abs(lowImpact),
          Math.abs(highImpact)
        )
      };
    })
    .sort((a, b) => b.magnitude - a.magnitude);
}

export function createTornadoPlot(
  data,
  contentController = null
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
    "One-at-a-time sensitivity of the selected objective to each design variable.";

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

  function getVisibleData() {
    if (contentController) {
      return contentController.getFilteredData(data);
    }

    return data;
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

    const sensitivity =
      calculateSensitivity(
        visibleData,
        objective.key
      );

    chart.selectAll("*").remove();

    if (!visibleData.length) {
      chart
        .append("text")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight / 2)
        .attr("text-anchor", "middle")
        .attr("class", "tornado-empty")
        .text(
          "No data available for the current filter."
        );

      subtitle.textContent =
        `0 designs analyzed — ${objective.label} sensitivity.`;

      return;
    }

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
            Low impact: ${variable.lowImpact.toFixed(4)}<br>
            High impact: ${variable.highImpact.toFixed(4)}
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
        `Estimated change in ${objective.label}`
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
          180
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
      .attr("x", 110)
      .attr("width", 14)
      .attr("height", 14);

    legend
      .append("text")
      .attr("x", 130)
      .attr("y", 12)
      .text("Variable maximum");

    subtitle.textContent =
      `${visibleData.length.toLocaleString()} designs analyzed — ` +
      `${objective.label} sensitivity.`;
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
