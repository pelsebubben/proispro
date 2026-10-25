# Architecture review history

## 2026-10-25 - Restrict shared-dev deployment privileges

Reviewed `.github/workflows/dev.yml`: pull requests no longer trigger deployment;
only manual dispatches from `main` with `DEV_ENABLED=true` can reach checkout
and Azure authentication. The job guard and pre-checkout validation enforce
the trusted ref and enabled setting. Updated the deployment boundary reference.
The runtime and authenticated-request drawings are unchanged. The production
delivery drawing remains accurate: main CI still gates production, documentation
runs independently, and shared dev retains its separate lock. No runtime,
schema, production gate or cloud-resource change.

## 2026-10-25 - Decouple documentation from production

Moved architecture checks, their contract tests and rendering into an independent
PR/main/manual workflow. Required CI still gates application, browser, API and
infrastructure checks; production starts from the exact successful main CI SHA
without waiting for or rebuilding documentation. Main documentation artifacts
retain exact-commit provenance. Documentation failures stay visible rather than
being masked with continue-on-error. Updated the delivery drawing and source
citations. No runtime, schema or cloud-resource change.

Separated the shell assignment/export to preserve renderer-path failures and
avoid ShellCheck SC2155. The documentation runner uses Ubuntu 22.04 rather than
the Ubuntu 24.04 runner whose AppArmor policy prevented Chromium sandbox startup.
The renderer's browser inspection gate remains enabled.

## 2026-10-25 - First-version maintenance baseline

Reviewed the React/Node composition, MSAL/JWT ownership path, resource/planner
handlers, schema migrations, PDGA cache, Bicep deployment and active CI/dev/prod
workflows. Retained the modular monolith and current cloud footprint.

Added runtime, authenticated-request and delivery diagram sources. Required CI
and pre-build production generation share one read-only workflow, with reviewed
source hashes and exact-commit artifact provenance. The reference pattern is
`C:\git\infra\.github\workflows\agentic-docs-check.yml` and its PowerShell guard;
this adaptation uses the application's existing Node toolchain, detects source
content drift (not only existing line ranges), and actually generates drawings
during production delivery. There is no label bypass for stale evidence.

Legacy plans are historical; this reference is the current maintainer entrypoint.
The review records shared dev/live failure boundaries, handler growth, analytics
split and restore-rehearsal work without changing runtime behavior or cloud
resources. Drawing validation demonstrates the documentation artifact, not a
successful live release.
