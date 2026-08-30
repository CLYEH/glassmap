import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored MapLibre worker build, see src/components/MapCanvas.tsx.
    "public/maplibre/**",
    // Local agent-harness workspace (gitignored): design archives and agent
    // worktrees live here, each carrying its own node_modules/.next. Absent
    // in CI; without this ignore a lint run from a checkout that has it
    // walks thousands of foreign files and reports ~36k false problems.
    ".claude/**",
  ]),
]);

export default eslintConfig;
