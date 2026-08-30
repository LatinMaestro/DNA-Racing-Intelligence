import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    files: [
      "tests/hosted-breeding-universe-inventory.test.ts",
      "tests/hosted-breeding-race-history-shard.test.ts",
      "tests/hosted-breeding-offspring-analysis.test.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  globalIgnores([".next/**", "coverage/**", "generated/**"]),
]);
