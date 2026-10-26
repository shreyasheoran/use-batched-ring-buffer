import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  ...tseslint.configs.strict,
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  { ignores: ["node_modules/**", "coverage/**", ".tmp/**", "bench/bench.js", "**/*.cjs", "*.config.*"] },
);
