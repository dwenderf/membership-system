## Dependency Overrides Tracking

npm overrides in `package.json` force patched versions of transitive dependencies that have security vulnerabilities. This file tracks each override so they can be removed once the upstream package ships a fix.

---

### `qs` — Dependabot alert #?

**Vulnerability:** prototype pollution / query string parsing issue  
**Affected versions:** < 6.14.2  
**Patched version:** 6.14.2  
**Introduced via:** (check with `npm ls qs`)  
**Override added:** `"qs": "^6.14.2"`

#### How to check if it can be removed
```bash
npm ls qs
```
Check whether any upstream package still requires a version below 6.14.2.

#### Acceptance criteria
- [ ] All upstream packages depend on qs@6.14.2 or higher (or no longer depend on qs)
- [ ] Remove the `qs` entry from `overrides` in package.json
- [ ] Run `npm install` and verify `npm audit` still shows 0 vulnerabilities

---

### `postcss` — Dependabot alert #57

**Vulnerability:** XSS via unescaped `</style>` in CSS Stringify Output (GHSA-qx2v-qp2m-jg93)  
**Affected versions:** < 8.5.10  
**Patched version:** 8.5.10  
**Introduced via:** `next@16.2.3 → postcss@8.4.31`  
**Override added:** `"postcss": "^8.5.10"`

#### How to check if it can be removed
```bash
npm view next@latest dependencies.postcss
```
Check whether `next` has updated to require postcss ≥ 8.5.10.

#### Acceptance criteria
- [ ] `next` depends on postcss@8.5.10 or higher (or no longer depends on postcss)
- [ ] Remove the `postcss` entry from `overrides` in package.json
- [ ] Run `npm install` and verify `npm audit` still shows 0 vulnerabilities

---

### `tar` — Dependabot alert #9 ✅ RESOLVED

**Vulnerability:** Race Condition in node-tar (GHSA-r6q2-hw4h-h46w)  
**Patched version:** 7.5.6  
**Introduced via:** `supabase`, `@tailwindcss/oxide`  
**Override removed:** upstream packages updated to use patched tar version  
**Original fix:** commit e0b6553
