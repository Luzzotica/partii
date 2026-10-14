import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

// No StrictMode: it double-mounts effects and would create, destroy, then
// recreate the Phaser game on every dev load.
createRoot(document.getElementById("root")!).render(<App />);
