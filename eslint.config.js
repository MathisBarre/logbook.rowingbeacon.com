import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ...pluginReact.configs.flat.recommended,
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    rules: {
      "react/react-in-jsx-scope": "off",
    },
  },
  {
    // The test-only analytics engine (node:sqlite) never ships (ADR 0008).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}", "src/**/testing/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/engine/nodeEngine"],
              message: "nodeEngine is for tests only.",
            },
          ],
        },
      ],
    },
  },
  {
    // The boathouse must never load or wait for analytics (plan 2.14).
    files: ["src/boathouse/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/analytics/**", "**/analytics"],
              message: "The boathouse never imports analytics.",
            },
            {
              group: ["**/engine/nodeEngine"],
              message: "nodeEngine is for tests only.",
            },
          ],
        },
      ],
    },
  }
);
