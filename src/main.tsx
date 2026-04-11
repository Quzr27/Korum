import React from "react";
import ReactDOM from "react-dom/client";
import { addCollection } from "@iconify/react";
import materialIcons from "@iconify-json/material-icon-theme/icons.json";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingsProvider } from "@/lib/settings-context";
import { VisibilityProvider } from "@/lib/visibility-context";
import { applySettings, loadBootstrapSettings } from "@/lib/settings";
import App from "./App";
import "./styles/app.css";

// Register bundled Material icon theme — prevents CDN fetch blocked by CSP in production.
addCollection(materialIcons);

// Apply bootstrap settings synchronously before first render to prevent theme flash.
// This cache is updated from the Rust-backed settings flow and falls back to the legacy key during migration.
applySettings(loadBootstrapSettings());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SettingsProvider>
      <VisibilityProvider>
        <TooltipProvider delayDuration={300}>
          <App />
        </TooltipProvider>
      </VisibilityProvider>
    </SettingsProvider>
  </React.StrictMode>,
);
