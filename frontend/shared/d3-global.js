// Demo 1's modules use the global `d3` that used to come from a CDN <script> tag.
// Importing this module first (before any module that touches `d3`) installs the
// npm copy on globalThis, so the page works offline and the version is pinned in
// package.json. ES modules evaluate imports in order, so the first import wins.
import * as d3 from "d3";

globalThis.d3 = d3;

export default d3;
