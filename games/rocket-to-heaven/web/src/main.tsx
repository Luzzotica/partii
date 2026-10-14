import { createRoot } from "react-dom/client";
import { installAnalytics, installErrorReporting } from "./analytics";
import { App } from "./App";
import "./index.css";

installErrorReporting();
installAnalytics();

// No StrictMode: it double-mounts effects and would create, destroy, then
// recreate the Phaser game on every dev load.
createRoot(document.getElementById("root")!).render(<App />);
