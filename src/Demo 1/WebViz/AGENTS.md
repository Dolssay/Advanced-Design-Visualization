# WebViz Agent Notes

These instructions apply to files in this `WebViz` directory and its subdirectories.

## Project Structure

- Keep `index.html`, `main.js`, and `README.md` at the root of `WebViz`.
- Store JavaScript helper modules in `scripts/`.
- Store CSS stylesheets in `stylings/`.
- Do not move the repository data files into `WebViz`; the viewer loads `../../../data/GTB777.csv`.

## JavaScript

- Use ES module imports.
- Import local helper modules from `./scripts/...` in root files and relative sibling paths inside `scripts/`.
- Keep menu/sidebar helpers in `scripts/contentbox.js` when working on the Content panel.
- Prefer CSS classes over inline style assignments.
- Use inline styles only for runtime values that must be computed dynamically, such as canvas dimensions, tooltip positions, cursor state, and selection overlay geometry.
- Keep D3-dependent code browser-friendly and avoid adding a bundler unless explicitly requested.

## CSS

- Put shared page styles in `stylings/base.css`.
- Put toolbar styles in `stylings/tools.css`.
- Put Content panel styles in `stylings/content.css`.
- Put scatterplot matrix styles in `stylings/splomGTB777.css`.
- Put plot cell, canvas, tooltip, and selection overlay styles in `stylings/zoomablePlot.css`.
- If JavaScript needs to pass dynamic visual values to CSS, prefer CSS custom properties over hardcoded inline declarations.

## HTML

- Link all stylesheet files from `index.html`.
- Keep the app root as `<div id="app"></div>`.
- Keep the module entrypoint as `./main.js`.

## Validation

- Serve from the repository root before testing:
  ```powershell
  npx.cmd http-server . -p 8000
  ```
- Open `http://localhost:8000/src/Demo%201/WebViz/index.html`.
- Do not test via `file://`, because ES modules and CSV loading require HTTP serving.
