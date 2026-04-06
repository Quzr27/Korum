import React from "react";
import ReactDOM from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingsProvider } from "@/lib/settings-context";
import { applySettings, loadBootstrapSettings } from "@/lib/settings";
import App from "./App";
import "./styles/app.css";

// Apply bootstrap settings synchronously before first render to prevent theme flash.
// This cache is updated from the Rust-backed settings flow and falls back to the legacy key during migration.
applySettings(loadBootstrapSettings());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SettingsProvider>
      <TooltipProvider delayDuration={300}>
        <App />
      </TooltipProvider>
    </SettingsProvider>
  </React.StrictMode>,
);
