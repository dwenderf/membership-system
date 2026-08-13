## Dependency Overrides Tracking

npm overrides in `package.json` force patched versions of transitive dependencies that have security vulnerabilities. This file tracks each override so they can be removed once the upstream package ships a fix.

---

### `js-yaml` — Dependabot alerts #99, #100, #123, #124, #83, #84

**Vulnerabilities:** three separate CVEs, each flagged once for each of the two copies js-yaml resolved to in the tree:
- CVE-2026-59869 / GHSA-52cp-r559-cp3m — YAML merge-key chains force quadratic CPU consumption. Fixed in 3.15.0 / 4.3.0 / 5.2.0.
- CVE-2026-53550 / GHSA-h67p-54hq-rp68 — quadratic-complexity DoS in merge key handling via repeated aliases. Fixed in 4.2.0 (3.x: 3.15.0).
- CVE-2026-59870 / GHSA-5p4m-2wfm-xmqj — quadratic CPU consumption in `!!omap` resolution. Fixed **only** in 5.2.1+ — the fix was never backported to the 3.x or 4.x lines, so no update within those lines can close this one.

**Affected versions:** effectively all of `3.x` and `4.x` (see above — some individual CVEs are patched at various 3.x/4.x points, but the `!!omap` one is unfixable outside 5.x).
**Patched version:** 5.2.1+ (all three CVEs fixed).
**Introduced via:**
- `@eslint/eslintrc` (dev, via `eslint`/`eslint-config-next`) → resolved `js-yaml@4.1.1` before the override.
- `@istanbuljs/load-nyc-config` (dev, via Jest's coverage/`babel-plugin-istanbul` chain) → resolved `js-yaml@3.14.2` before the override. This package has had exactly one release (`1.1.0`) requiring `js-yaml@^3.13.1`, and there's an open, unresolved upstream issue about it (jestjs/jest#16243) — it cannot be updated to fix this on its own.

**Override added:** `"js-yaml": "^5.2.3"`

**Compatibility note:** both consumers only call `yaml.load(...)`, the plain safe-by-default API that's unchanged between js-yaml 4.x and 5.x (5.x removed the `safe*` aliases and reworked advanced schema/custom-tag APIs, neither of which these consumers use). Verified via `npm run lint` and `npm run test:coverage` after applying the override.

#### How to check if it can be removed
```bash
npm view @istanbuljs/load-nyc-config dependencies.js-yaml
npm view @eslint/eslintrc@latest dependencies.js-yaml
```

#### Acceptance criteria
- [ ] `@istanbuljs/load-nyc-config` (or whatever replaces it in Jest's coverage chain) depends on `js-yaml@^5`
- [ ] `@eslint/eslintrc` depends on `js-yaml@^5`
- [ ] Remove the `js-yaml` entry from `overrides` in package.json
- [ ] Run `npm install` and verify `npm audit` still shows 0 vulnerabilities

---

### `qs` — Dependabot alert #? ✅ RESOLVED

**Vulnerability:** prototype pollution / query string parsing issue
**Affected versions:** < 6.14.2
**Patched version:** 6.14.2
**Introduced via:** `stripe` (`qs@^6.11.0` range)
**Override removed:** a plain `npm install` now resolves `qs` to `6.15.2` (latest published patch line) without forcing — the range was never the constraint, the lockfile was just stale.

---

### `postcss` — Dependabot alert #57 ✅ RESOLVED

**Vulnerability:** XSS via unescaped `</style>` in CSS Stringify Output (GHSA-qx2v-qp2m-jg93)
**Affected versions:** < 8.5.10
**Patched version:** 8.5.10
**Introduced via:** `next@16.2.3 → postcss@8.4.31`
**Override removed:** current `next@16.3.0` depends on `postcss@8.5.23` directly, and `@tailwindcss/postcss` resolves `postcss@8.5.26` — both well above the patched floor without forcing.

---

### `tar` — Dependabot alert #9 ✅ RESOLVED

**Vulnerability:** Race Condition in node-tar (GHSA-r6q2-hw4h-h46w)
**Patched version:** 7.5.6
**Introduced via:** `supabase`, `@tailwindcss/oxide`
**Override removed:** upstream packages updated to use patched tar version
**Original fix:** commit e0b6553

**Follow-up (same package, new CVE):** a second tar advisory (GHSA-r292-9mhp-454m, uncontrolled recursion in `mapHas`/`filesFilter`, moderate, affects <=7.5.20) surfaced later via `@tailwindcss/oxide@4.1.12 → tar@7.5.19`. Resolved the same way — no override needed, `npm audit fix` picked up the already-compatible `tar@7.5.22`.
