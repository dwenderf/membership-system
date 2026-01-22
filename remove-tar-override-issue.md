## Remove tar dependency override once upstream packages are fixed

### Background
We added an npm override for the `tar` package in package.json to resolve Dependabot security alert #9 (high severity vulnerability in tar@7.5.3).

```json
"overrides": {
  "tar": "^7.5.6"
}
```

This override forces the use of patched tar versions (≥7.5.6) even though upstream packages `supabase` and `@tailwindcss/postcss` still depend on the vulnerable version.

### Task
Remove the override once both upstream packages have been updated to use a patched tar version (≥7.5.4).

### How to check
Run these commands to check if upstream packages have updated:

```bash
npm view supabase@latest dependencies.tar
npm view @tailwindcss/postcss@latest dependencies.tar
```

### Acceptance criteria
- [ ] `supabase` depends on tar@7.5.4 or higher (or no longer depends on tar)
- [ ] `@tailwindcss/postcss` depends on tar@7.5.4 or higher (or no longer depends on tar)
- [ ] Remove the `overrides` section from package.json
- [ ] Run `npm install` and verify `npm audit` still shows 0 vulnerabilities
- [ ] Commit and push changes

### References
- Original fix: commit e0b6553
- Dependabot alert: #9
- Vulnerability: GHSA-r6q2-hw4h-h46w (Race Condition in node-tar)
