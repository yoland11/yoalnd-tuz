import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { configureApiSession } from "./lib/api-session";

configureApiSession();

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    navigator.serviceWorker
      .register(`${base}/sw.js`, { scope: `${base}/` })
      .catch(() => { /* SW registration is non-fatal */ });
  });
}
