export function fmt(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtValue(value, spec) {
  if (value === null || value === undefined) return "—";
  if (spec?.integer) return String(Math.round(value));
  // At least the step's precision, up to 4 decimals, trailing zeros dropped (15.24 stays 15.24).
  return String(+Number(value).toFixed(Math.max(decimalsForStep(spec?.step ?? 0.01), 4)));
}

export function decimalsForStep(step) {
  const text = String(step);
  return text.includes(".") ? text.split(".")[1].length : 0;
}

export function withUnit(text, unit) {
  return unit ? `${text} ${unit}` : text;
}

export function signed(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const s = fmt(Math.abs(value), digits);
  return value > 0 ? `+${s}` : value < 0 ? `−${s}` : s;
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
