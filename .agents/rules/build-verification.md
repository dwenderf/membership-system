---
trigger: always_on
---

Before reporting work complete, run npm run build and paste the raw, unfiltered output — including the final success or error lines. Do not summarize, scope, or filter the result (e.g. "0 errors in modified files"). If the build fails, fix it and re-run; do not report completion with a failing build.

npx tsc --noEmit is a faster subset useful during iteration, but it is not a substitute: npm run build additionally parses pages and components that no test imports, runs lint, and validates server/client boundaries.

The same applies to test runs: paste the actual Jest output, not a description of it.