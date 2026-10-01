# crs_status_service — Package Rules

- Lint with `npm run lint-fix`, not `npm run lint`.
- `src/phase.ts` mirrors `packages/operator/src/high_priority_status.ts`; any
  change to it comes with matching changes in `__tests__/phase.test.ts`.
