# Customer login without Supabase

## Deployment model

The owner clarified that Griplock is initially for personal use and friends.
Operate one live application and one PostgreSQL server, not duplicate staging/
production stacks. The existing resource/workflow names contain `staging`; keep
them to avoid needless resource replacement. The release pipeline is the test/
deployment gate. `griplock_verify` is disposable test data, `griplock` is application
data; never run integration tests against the application database.

Do not add preview infrastructure, enterprise review ceremony or a second server
as a prerequisite to customer login. Production/DNS/data deletion still require
explicit scope; simplifying deployment does not authorize deletion or migration.

## Implemented application side

The Azure runtime no longer trusts the old Supabase issuer by default. With no
customer configuration it remains explicitly signed out; partial configuration
fails deployment preflight/startup rather than falling back to Supabase.

Microsoft's `@azure/msal-browser` implements authorization code + PKCE, redirect
handling, state/nonce, token caching in session storage, silent acquisition and
logout. No client secret is shipped to the browser. The API verifies access-token
signature, exact issuer, API audience, expiry and delegated `scp` membership.
An ID token for the separate browser registration is not an API token.
The API maps `(issuer, sub)` to its own PostgreSQL user ID; email addresses are
display-only and must never automatically link old Supabase accounts.

The customer sign-in screen redirects to the customer tenant's hosted user flow;
Google is selected/configured there, not by a fake Google button that still uses
Supabase. Failed/cancelled login is visible. Signed-in Azure users see a connection
confirmation, not the old Supabase-backed screens. This intentionally exposes
the remaining data migration rather than silently returning empty collections
or making requests to the old service.

**This is not yet complete Supabase removal:** collection, bag, course, wishlist
and sale hooks still use Supabase on the legacy Pages app. They do not mount for
Azure identities. Migrate these schemas/API callers and explicitly map/import
existing data before retiring the old project. GitHub login remains legacy-only.

## External configuration still needed

Directory discovery on 2026-10-23 exposed only the workforce directory
`07d87066-942e-4072-8596-36dd123efc1b`, named `demotroll`, and no Griplock app
registration. No customer tenant, Google credentials, accounts or new directory
permissions were created. An inaccessible existing customer tenant may still
exist; do not assume discovery proves otherwise.

Continue the previously agreed Entra External ID customer-tenant approach:

1. Select the existing **external/customer** tenant, or explicitly authorize a
   new one. Do not use `/common` or a workforce guest invitation as a substitute
   for consumer Google login.
2. Register a Griplock API with v2 access tokens. Expose a delegated permission,
   for example `access_as_user`.
3. Register a separate Griplock browser app with the **Single-page application**
   redirect platform. Grant it the API's delegated permission. Register the exact
   current Azure origin as the redirect URI:
   `https://app-griplock-staging.delightfulisland-939e03e4.swedencentral.azurecontainerapps.io`.
   Do not add wildcard redirects, implicit-flow tokens or a browser client secret.
4. Create/configure a sign-up/sign-in user flow, associate the browser app, and
   enable Google federation. The owner must configure the Google OAuth project/
   consent and its provider callback from Entra. Store Google's client secret
   only in the identity provider configuration, never here or in chat.
5. Obtain issuer and JWKS URL from that tenant's OpenID discovery document.
   Do not guess them or use Microsoft Graph access tokens as app API tokens.

Configure these nonsecret variables in the current GitHub release environment
`staging-infrastructure`; the name is a deployment boundary, not another app:

| Variable | Value |
|----------|-------|
| `ENTRA_CLIENT_ID` | Browser app's client UUID |
| `ENTRA_AUTHORITY` | Customer tenant's HTTPS `ciamlogin.com` authority |
| `ENTRA_API_SCOPE` | Full delegated permission URI exposed by the API |
| `AUTH_ISSUER` | Exact v2 issuer from discovery/token claims |
| `AUTH_AUDIENCE` | API app's client UUID, different from browser client ID |
| `AUTH_JWKS_URL` | JWKS URL from discovery, same authority origin |
| `AUTH_REQUIRED_SCOPE` | Delegated permission name, e.g. `access_as_user` |

All seven values must be supplied together, or all absent. No authentication
secret is needed in GitHub or in the app for this public-client PKCE flow.
Current support intentionally uses the standard `ciamlogin.com` host; custom
identity domains need separate validation before changing that contract.

Deploy normally after configuring the tenant. `/auth/config` returns only public
runtime configuration; `/runtime-config.js` delivers the same configuration with
no caching. The release manifest records whether identity is configured, which
is not evidence that a real person completed Google sign-in.

## Evidence and final acceptance

Local/browser fixtures exercise the real MSAL authorization redirect, code flow,
S256 PKCE, requested API scope, state/nonce, callback cancellation and no Supabase
requests. Real PostgreSQL tests verify signed API tokens, wrong audience/expiry,
scope denials, ownership/RLS and persistence.

A real customer flow still requires an owner-assisted browser check with a
dedicated account: sign in with private Gmail, confirm the API-mapped identity,
reload, sign out, reject expired/incorrect tokens and prove cross-user denial.
CAPTCHA/MFA/consent cannot be bypassed. Never upload tokens, browser storage or
real identity-provider traces to public CI evidence.

Once login works, replace the remaining Supabase data hooks with application API
calls using the API access token. Preserve existing features/data unless a
specific removal or fresh start is approved.
