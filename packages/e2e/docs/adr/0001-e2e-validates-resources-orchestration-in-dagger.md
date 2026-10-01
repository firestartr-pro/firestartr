# e2e validates resources; environment orchestration lives in dagger/etoe

The `packages/e2e` package only performs Resource validation — asserting that
reconciled CRs reach their expected state. Environment and image orchestration —
operator image selection, pull policy, Kind image availability, private registry
authentication, and operator/chart upgrade choreography — are deliberately kept
out of `packages/e2e` and live in `dagger/etoe` and `.github/workflows/e2e.yaml`.
This keeps the test package focused on behavior and prevents environment concerns
from leaking into resource assertions (which had started to happen in the
org-script CRD upgrade test).
