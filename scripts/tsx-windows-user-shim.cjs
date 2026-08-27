// See run-tsx.mjs. This is CommonJS because NODE_OPTIONS --require loads it
// before TSX's CommonJS bootstrap files.
if (process.platform === "win32" && typeof process.geteuid !== "function") {
  process.geteuid = () => 1000;
}
