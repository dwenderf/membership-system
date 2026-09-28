import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import noFloatingEmailSend from "./scripts/eslint-rules/no-floating-email-send.js";

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
    // console.* is disallowed outright: anything audit-worthy belongs in
    // the centralized logger (src/lib/logging/logger.ts), and scratch
    // debugging must not be committed (see
    // docs/guides/development.md#logging-standards). The pre-existing
    // console.* call sites have all been swept (epic #334); a small number
    // of files carry a targeted eslint-disable-next-line for a deliberate,
    // documented exception rather than a blanket override.
    rules: {
      "no-console": "error",
    },
  },
  {
    // Email notifier calls and email_logs writes must not be fire-and-forget:
    // Vercel freezes the function once the response is sent, which silently
    // drops floating promises (#395, fixed in #398). Await them, return them,
    // or schedule them with runAfterResponse()/after(). Escape hatch:
    //   // eslint-disable-next-line local/no-floating-email-send -- <reason>
    // Scoped to route handlers and server-side email/processor code.
    files: [
      "src/app/api/**/route.ts",
      "src/lib/email/**/*.ts",
      "src/lib/services/**/*.ts",
      "src/lib/**/*processor*.ts",
    ],
    plugins: {
      local: { rules: { "no-floating-email-send": noFloatingEmailSend } },
    },
    rules: {
      "local/no-floating-email-send": "error",
    },
  },
  {
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-console": "off",
    },
  },
  {
    // The logger's own console.log/warn/error calls ARE its
    // console-output implementation, plus the deliberate
    // circular-logging-prevention fallback.
    files: ["src/lib/logging/logger.ts"],
    rules: {
      "no-console": "off",
    },
  },
];

export default eslintConfig;
