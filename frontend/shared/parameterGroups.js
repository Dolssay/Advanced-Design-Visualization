// Shared parameter-group palette for screening and future parallel-coordinate views.
export const PARAMETER_GROUP_COLORS = Object.freeze({
  Mission: "--label-l21",
  Geometry: "--label-l22",
  Propulsion: "--label-l11",
  Battery: "--accent"
});

export function parameterGroupColor(group) {
  const token = PARAMETER_GROUP_COLORS[group];
  return token ? `var(${token})` : "var(--faint)";
}
