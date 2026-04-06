import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Stub Tauri API modules so tests don't need the native runtime
      "@tauri-apps/api/core": path.resolve(__dirname, "./src/__mocks__/tauri-api-core.ts"),
      "@tauri-apps/plugin-clipboard-manager": path.resolve(
        __dirname,
        "./src/__mocks__/tauri-plugin-clipboard.ts",
      ),
      "@tauri-apps/plugin-dialog": path.resolve(
        __dirname,
        "./src/__mocks__/tauri-plugin-dialog.ts",
      ),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    globals: true,
  },
});
