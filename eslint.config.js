import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactCompiler from "eslint-plugin-react-compiler";

export default tseslint.config(
  // ── Global ignores ──
  { ignores: ["src-tauri/", "dist/", "src/components/ui/"] },

  // ── Base JS recommended ──
  js.configs.recommended,

  // ── TypeScript strict ──
  ...tseslint.configs.strict,

  // ── React hooks ──
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // ── React Compiler ──
  {
    plugins: { "react-compiler": reactCompiler },
    rules: {
      "react-compiler/react-compiler": "warn",
    },
  },

  // ── Project-specific overrides ──
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Allow _ prefixed unused vars (common in destructuring)
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
      // Allow non-null assertions (xterm refs, DOM refs)
      "@typescript-eslint/no-non-null-assertion": "off",
      // Allow empty catch blocks (intentional swallows in PTY cleanup)
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Allow void for fire-and-forget invokes
      "@typescript-eslint/no-floating-promises": "off",
      // Allow dynamic delete on ref objects (viewportsRef cleanup)
      "@typescript-eslint/no-dynamic-delete": "off",
      // Refs in render body — intentional stateRef/latestSettingsRef pattern for save callbacks
      "react-hooks/refs": "off",
      // Sync effects for prop→state derivation (hidden→isEditing, settings→draft)
      "react-hooks/set-state-in-effect": "off",
    },
  },

  // ── Test files — relax rules ──
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "react-hooks/globals": "off",
    },
  },
);
