# operator — Package Rules

## Scope

The operator is a pure actuator: it watches CRs and runs each kind's
operation. It holds no business logic.

- Claim rendering, validation, transformation, templating, persistence or
  caching belong in other packages (`cdk8s_renderer`, `catalog_common`, …).
- No HTTP endpoints beyond the existing metrics and admission webhook servers.
- Each kind family gets its own `src/<family>/` directory with a
  `process-operation.ts` entry point (`src/tfworkspaceplans/` keeps its
  `processOperationPlan.ts`). Never put kind logic in `processItem.ts` or other
  top-level files.
- Feedback paths (check runs, PR comments, commit statuses) must use
  `github.withProfile('operator')`, never bare `github.*` calls that read auth
  from `process.env`.

## Validation

From `packages/operator/`, in order:

```sh
npm run lint-fix
npx tsc --noEmit
export ORG=firestartr-test && npm test -- --runInBand
```

Unit tests must not reach external services (Kubernetes, GitHub, AWS SSM).
