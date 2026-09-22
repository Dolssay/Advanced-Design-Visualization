// Small color helpers shared by anything that draws a highlight outline on top of a
// point/line whose own fill color varies per label (splom points, parallel-coordinates
// lines). No dataset- or chart-specific assumptions -- works for any hex color.

function parseHexColor(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!match) {
    return null;
  }
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

// Perceived luminance (ITU-R BT.601 weights), 0 (black) to 1 (white).
function getRelativeLuminance(hex) {
  const rgb = parseHexColor(hex);
  if (!rgb) {
    return 1; // unknown input: assume light, so callers default to the dark outline
  }
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

export function isColorDark(hex, threshold = 0.35) {
  return getRelativeLuminance(hex) < threshold;
}

// Picks an outline color that stays visible against a fill of `hex`: a light grey when
// the fill is already dark (so the outline doesn't disappear into it), otherwise the
// standard dark outline used throughout the app's highlight styling.
export function getHighlightOutlineColor(hex, { dark = "#111827", lightOnDark = "#9ca3af" } = {}) {
  return isColorDark(hex) ? lightOnDark : dark;
}
