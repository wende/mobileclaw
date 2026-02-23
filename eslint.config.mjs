import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooksPlugin from "eslint-plugin-react-hooks";

export default tseslint.config(
  // ── Ignores ────────────────────────────────────────────────────────────────
  { ignores: [".next/", "node_modules/", ".claude/", "public/", "*.config.*"] },

  // ── typescript-eslint recommended + type-checked ───────────────────────────
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── Next.js rules ──────────────────────────────────────────────────────────
  {
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },

  // ── React hooks rules ──────────────────────────────────────────────────────
  {
    plugins: { "react-hooks": reactHooksPlugin },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // ── Rule overrides ─────────────────────────────────────────────────────────
  {
    rules: {
      // Downgrade to warn — too noisy for existing codebase
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",

      // Allow empty catch blocks (common pattern in this codebase)
      "@typescript-eslint/no-empty-function": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],

      // Allow unused vars with _ prefix
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Relax for event handler patterns and React callbacks
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false, arguments: false } },
      ],

      // Common in React — fire-and-forget in useEffect, callbacks, event handlers
      "@typescript-eslint/no-floating-promises": [
        "error",
        { ignoreVoid: true, ignoreIIFE: true },
      ],

      // API route handlers and React patterns
      "@typescript-eslint/require-await": "off",

      // React callback destructuring pattern
      "@typescript-eslint/unbound-method": "off",

      // Allow non-null assertions (used carefully in this codebase)
      "@typescript-eslint/no-non-null-assertion": "off",

      // Redundant type constituents — too noisy with union string patterns
      "@typescript-eslint/no-redundant-type-constituents": "off",

      // Template literal expressions — too restrictive with union types
      "@typescript-eslint/restrict-template-expressions": "off",

      // Allow require imports (used by Next.js config files)
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // ── Test files — relax type-aware rules ────────────────────────────────────
  {
    files: ["tests/**/*.ts", "tests/**/*.tsx", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
