import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    // Claude Code creates other git worktrees under .claude/worktrees/ inside
    // this checkout. ESLint's flat config doesn't read .gitignore, so without
    // this they get linted too — including their own .next build output.
    ignores: ["**/.claude/worktrees/**"],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
