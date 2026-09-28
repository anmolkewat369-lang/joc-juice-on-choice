import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import Root from "./Root.jsx";

/**
 * The entry point. Everything with a decision in it lives in Root.jsx, so this
 * file only has one job: mount React and get out of the way.
 */
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
