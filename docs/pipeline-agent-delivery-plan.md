# Griplock pipeline and agent delivery plan

Status: Implementation roadmap, 2026-10-23. The initial CI, synthetic browser
suite and disabled staging infrastructure entry point are implemented; see
[the operational runbook](github-pipelines.md). Previews, deployed E2E and
Azure image promotion remain planned. This roadmap extends the
[infrastructure lifecycle plan](infrastructure-lifecycle-plan.md).

## Goal and authority

An authorized coding agent must be able to reproduce a failure, change code,
run tests, deploy a non-production candidate, collect evidence, and repeat
without an operator performing every staging deployment.

Confirmed authority:

- Automatic PR checks.
- Approved agents may deploy and iterate in non-production.
- Production requires the owner's approval for the exact release.
- No implicit permission to change identity providers, grant roles, change DNS,
  destroy resources, or migrate live user data.

Agent availability, credentials, and tool permissions still apply. A workflow
cannot grant a conversation capabilities it does not have.

## Current gaps

The repository is public. `.github/workflows/deploy.yml` deploys main directly
to GitHub Pages; `squad-ci.yml` targets `test/*.test.cjs`, but no matching test
suite was found. `package.json` declares Playwright, but no checked-in test
configuration or suite was found.

Configured GitHub environments observed during discovery: `copilot` and
`github-pages`. Proposed preview, staging, and production protection rules
must be configured explicitly, not assumed to exist.

## Proposed workflow responsibilities

Keep responsibilities distinct; share scripts instead of copying deployment
logic between YAML files.

| Workflow | Trigger and trust | Responsibilities |
|----------|-------------------|------------------|
| `ci.yml` | All PRs and main pushes, no Azure credentials | Build, static checks, unit/API tests, PostgreSQL integration, local browser E2E, local Bicep validation |
| `preview.yml` | Authorized dispatch from trusted default-branch workflow | Verify exact PR SHA/checks, build and scan candidate, deploy isolated preview, run deployed E2E |
| `release.yml` | Main after required checks | Build/scan once, publish digest and manifest, deploy staging, run acceptance suite |
| `promote.yml` | Owner-approved release selection | Verify staging evidence and schema compatibility, approve production environment, deploy same digest, smoke-test |
| `infra.yml` | Reviewed dispatch from trusted workflow | Validate Bicep, show what-if, apply to selected environment with its approval boundary |
| `maintenance.yml` | Scheduled or authorized dispatch | Expired preview cleanup, bounded drift checks, recovery exercises |

These are responsibilities, not a mandate to implement all six files at once.
Ship CI first, then preview/staging, then promotion and recovery.

## Trust boundary for a public repository

Use GitHub-hosted ephemeral runners for untrusted PR code. Default token
permissions are read-only, checkout credentials are not persisted, and PR jobs
get no cloud credentials, OIDC permission, private registry access, or production
data. Pin third-party actions to reviewed commit SHAs.

Do not execute PR code through `pull_request_target`. Do not use an unverified
PR artifact or workflow result as authority for a privileged deployment.
Protect workflows, infrastructure, auth configuration, and migrations with
review rules and CODEOWNERS. Required checks must resolve for docs-only changes
too; avoid leaving merge checks pending through workflow path filtering.

Preview dispatch accepts a PR number and full commit SHA, not shell commands,
arbitrary image references, URLs, or resource names. A trusted controller checks
the caller's authorization, PR origin, current head SHA, CI results, and approval
status through GitHub. Recheck the SHA before deployment. New pushes invalidate
evidence and require CI again. Fork previews require explicit maintainer trust;
a label or PR title alone is not authorization.

Build candidate code in a job without Azure credentials. A separate deployment
job obtains environment-scoped OIDC credentials and uses a verified digest.
Candidate code still runs inside Azure: give it only its own disposable database,
objects, and limited runtime identity, with no staging/production secret access
or cloud management rights. Keep the preview environment and permissions
separate from production and trusted staging.

Privileged workflows must be established on the default branch before agents
can use them. Dispatching a candidate does not run workflow YAML supplied by
that candidate. PR comments and logs are untrusted input, not instructions to
the deployment controller or agent.

## Isolated preview strategy

Recommend one preview application per authorized active PR, with one database
and restricted database login per preview on a non-production PostgreSQL server,
plus a per-preview object container/access scope. Database-per-preview is simpler
and safer for migration tests than a shared schema with naming conventions.

Use generated Container Apps HTTPS hostnames initially. Real Entra redirects
use a fixed staging hostname, not unlimited preview callback registrations.
Previews test application authentication using a controlled test issuer.

Each update has an immutable generation ID tied to the SHA. Serialize
deploy/migrate/test per PR through verification; pin the tested revision and
check its reported SHA before and after E2E. Never run two candidate migrations
against the same preview generation concurrently. Use fresh synthetic state
for independent runs; preserve a failed generation briefly for investigation.

Proposed initial limits: three active previews, 24-hour idle expiry, and a
seven-day maximum lifetime. Confirm capacity/cost and adjust before enabling.
On PR closure or expiry, remove only resources tagged with the validated
preview identity. Scheduled cleanup catches missed close events. Never delete
shared servers or broad resource groups through wildcard cleanup.

## Test pyramid and realistic E2E

| Layer | Contract proved |
|-------|-----------------|
| Unit and API | Validation, ownership checks, expected errors, API compatibility |
| PostgreSQL integration | Real SQL, migrations, transactions, RLS and pooled-connection isolation |
| Local browser | Built container + PostgreSQL, controlled identity and course-provider fixtures |
| Azure preview | Real ingress, runtime configuration, object storage, deployed image and browser journey |
| Trusted staging | Exact release image, real customer identity integration, migration rehearsal, performance |
| Production smoke | Safe availability/auth checks after approved deployment, no destructive fixtures |

Core browser journeys: sign in, load owned discs, create/edit a configuration,
add/remove membership, associate a fixture course, reload and prove persistence.
Use two synthetic users to prove that one cannot access the other's data.
Also cover expired sessions, rejected writes, empty states, narrow mobile
viewports, keyboard use, provider timeouts, and refresh/deep-link routing.
Retain existing journeys until their removal is explicitly approved.

Deterministic tests use a fixture course provider. Separately exercise the
licensed live provider within its limits once selected; fixture tests do not
prove live provider availability. Do not scrape a provider for test fixtures.

### Authentication without production bypasses

Use a standards-compliant local/test OIDC issuer with synthetic identities for
repeatable application E2E, including signature, issuer, audience, expiry,
nonce/state, and PKCE validation as applicable. Never add a "test user" header,
magic session endpoint, or switch that disables authorization.

Production configuration must reject the test issuer; assert this in tests
and deployment validation. Preview credentials and authentication artifacts
must not grant access to trusted staging or production.

A separate trusted staging check must verify real Entra discovery, token
validation, redirects, and user mapping. Personal Google sign-in requires an
actual browser-delegated flow; client credentials are not an equivalent test.
Use dedicated accounts and compliant provider automation only where supported.
CAPTCHA, MFA, consent, or account recovery may require a human-assisted check;
do not bypass them or claim full unattended coverage when it is unavailable.

Record interactive identity evidence against the release, environment, and
auth configuration version. Changes to identity settings invalidate it.
Do not publish tokens, browser storage state, cookies, or login traces as
public CI artifacts. Public-repository artifact access must be treated as public;
sensitive diagnostic evidence belongs in restricted storage, not masked logs.

## Agent iteration contract

Provide documented package scripts for build/check, unit, integration, E2E,
database migration, and synthetic seeding. Exact names are chosen during
implementation and used identically by local development and CI.

An agent iteration:

1. Read the failed check and reproduction metadata for the exact SHA.
2. Reproduce locally against isolated fixtures; implement the fix and focused test.
3. Push changes and wait for required CI on the new SHA.
4. Request authorized preview deployment; inspect its URL, digest and run ID.
5. Run deployed E2E and inspect redacted logs, request IDs, screenshots, and traces.
6. Fix a concrete failure and repeat; stop and report when blocked on permissions,
   provider interaction, repeated unexplained failures, or agreed execution limits.

No self-modification of checks to hide failures, unlimited retry loop, automatic
merging, or production promotion is implied. Keep dependencies/production data
out of the agent's staging mutation scope.

Every run writes a versioned, machine-readable result and GitHub summary:
commit SHA, image digest, preview generation/URL, run ID, migration version,
fixture version, test totals, failures/skips/retries, and evidence links.
Upload sanitized JUnit, Playwright HTML reports, failure screenshots and traces.
Use short artifact retention, initially seven days. Disable sensitive capture
around real identity-provider screens.

Collect evidence even on failure. Infrastructure, migration, or seed failures
must fail the run, not produce green checks with zero executed tests. Limited
retries remain visible and cannot turn a flaky release gate into an unexplained
pass. Define expected test inventory so accidental skipping is detectable.

## Infrastructure deployment and recovery

Validate Bicep locally without credentials on every infrastructure PR. A trusted
workflow produces Azure what-if output using environment-scoped access.
What-if is a review aid, not a guarantee; inspect unresolved/unsupported changes.
Require separate approval for destructive changes, access-policy changes, or
production scope. Agents may apply ordinary reviewed staging changes within
their pre-approved resource boundary, not grant themselves broader permissions.

Run database migrations as a finite Container Apps Job with private database
connectivity and a dedicated migration identity/role. GitHub starts the job and
checks its exit status and migration version, without exposing the database to
public runners. Runtime replicas do not run migrations on startup.

Use a release ledger linking source, image, schema, infrastructure revision,
configuration version, test evidence and approval. Production promotion rejects
unverified or stale manifests. Reconfirm evidence after the approval wait and
serialize promotion/migration/verification. Keep the previous healthy revision.
An image rollback is allowed only with compatible schema/configuration.

Exercise deploy failure, migration failure, restart persistence, and revision
rollback in staging. Before cutover, restore database and objects to a separate
target and verify ownership and references. Recovery objectives and HA remain
explicit decisions, not inferred guarantees.

## Ordered implementation milestones

1. **CI baseline:** reconcile existing CI, add actual tests/configuration, stable
   package commands, local container/PostgreSQL harness, and required checks.
2. **Bootstrap:** approve region/cost/identity scope, create Azure non-production
   resources and OIDC trust, configure environment permissions and protected files.
3. **Agent preview:** authorized SHA-pinned deployment, isolated fixtures,
   browser/API E2E, sanitized evidence, limits and cleanup.
4. **Release staging:** immutable promotion candidate, real Entra/Google proof,
   private migrations, compatibility checks and recovery rehearsal.
5. **Production gate:** owner approval, same-digest promotion, safe smoke checks,
   compatible rollback, alerts and release ledger.

Completion means an agent demonstrates one genuine failed E2E run, diagnoses it
from evidence, fixes it, and obtains green checks on a new SHA without manual
deployment steps. Separately demonstrate that an untrusted fork gets no Azure
access and that production cannot deploy without owner approval.

## Documentation references

- [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use)
- [Manual dispatch and default-branch requirement](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [Azure OIDC federation](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect)
- [Bicep what-if](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/deploy-what-if)
- [Container Apps Jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs)
