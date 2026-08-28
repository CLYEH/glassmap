## What

<!-- One paragraph. -->

## Why

<!-- User-visible reason. Task id from docs/TASKS.md (e.g. T-11). -->

## How verified

<!-- Paste the tail of `pnpm check` and `pnpm test:e2e`. UI changes: screenshot or the data-testid values that changed. -->

```
pnpm check   →
pnpm test:e2e →
```

## Checklist

- [ ] `pnpm check` and `pnpm build` green locally
- [ ] `reviewer` agent run; high-severity findings fixed or declined below
- [ ] No `alert`/`confirm`/`prompt`, no external APIs or keys
- [ ] Docs updated if judges/users can see the change
- [ ] Everything English
