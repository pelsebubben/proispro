# Customer and developer login

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

With no customer configuration the live runtime remains explicitly signed out;
partial configuration fails deployment preflight/startup. There is no alternate
provider SDK, legacy auth fallback or direct browser-to-database access.

Microsoft's `@azure/msal-browser` implements authorization code + PKCE, redirect
handling, state/nonce, token caching in session storage, silent acquisition and
logout. No client secret is shipped to the browser. The API verifies access-token
signature, exact issuer, API audience, expiry and delegated `scp` membership.
An ID token for the separate browser registration is not an API token.
The API maps `(issuer, sub)` to its own PostgreSQL user ID; email addresses are
display-only and never used to link identities.

The current account header displays MSAL's account username. For a federated
Google user, this can be an Entra-generated `@griplockcustomers.onmicrosoft.com`
username rather than the Google email address. It does not change which
identity owns the application data.

The customer sign-in screen redirects to the customer tenant's hosted user flow;
Google is selected/configured there. Failed/cancelled login is visible.
Signed-in users see the real inventory, bags, collections, wishlist, sale,
course and analytics screens, all backed by the authenticated Node API.

The owner approved starting fresh. The schema uses application-owned `app_users`
and PostgreSQL RLS; no old records or identities are copied. The retired remote
service remains untouched.

## Production identity configuration

The owner configured the **Griplock Customers** external tenant
(`23ed0ae8-6f57-46c5-9b6b-bc223a923224`). Its separate **Griplock Web** and
**Griplock API** registrations use v2 tokens, SPA redirect URIs and the delegated
`access_as_user` permission, with tenant-wide admin consent already granted.
The **GriplockSignIn** user flow is associated with the Web registration and
offers Google and email/password sign-in. The seven public runtime values below
are stored in the GitHub `prod` environment; Google's client secret remains
only in the identity-provider configuration, and the browser needs no secret.

The existing release workflow consumes these values. After changing them, run
**Release Griplock prod** on `main` to deploy the configuration; editing a GitHub
variable alone does not update a running revision. The shared dev deployment
continues to use its passcode login instead of customer identity.

For a replacement tenant or application registration, use the same setup:

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

Configure these nonsecret variables in the GitHub environment `prod`:

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

Use the canonical tenant-ID authority
`https://23ed0ae8-6f57-46c5-9b6b-bc223a923224.ciamlogin.com/23ed0ae8-6f57-46c5-9b6b-bc223a923224`
and obtain issuer and JWKS URL from its `/v2.0/.well-known/openid-configuration`.
Discovery through the friendly `griplockcustomers.ciamlogin.com` hostname
returns a tenant-ID issuer but a friendly-hostname JWKS URL. Mixing those
origins is intentionally rejected by the app. Using the canonical hostname
for all three endpoints preserves the exact-issuer and same-origin checks.

The Google OAuth client's **Authorized redirect URIs** must also include the
callback for that canonical hostname, exactly (without a trailing slash):

```text
https://23ed0ae8-6f57-46c5-9b6b-bc223a923224.ciamlogin.com/23ed0ae8-6f57-46c5-9b6b-bc223a923224/federation/oauth2
```

This is Google's callback to Entra, not the browser app's SPA redirect to
Griplock. A callback for the workforce tenant or a different hostname does not
cover this URL; Google rejects the request with `redirect_uri_mismatch`. The
customer callback was added with owner approval on 2026-10-24, preserving all
seven existing entries. Keep any existing callbacks needed by other clients.

Deploy normally after configuring the tenant. `/auth/config` returns only public
runtime configuration; `/runtime-config.js` delivers the same configuration with
no caching. The release manifest records whether identity is configured, which
is not evidence that a real person completed Google sign-in.

## Local development and security testing identity

For building, testing and pentesting without Entra, the server has a
**local-only test identity provider**. It is not an auth bypass: it mints
short-lived ES256 tokens from an in-memory key, and the API runs the same
signature, issuer, audience, expiry, `scp` and PostgreSQL RLS checks as for
real customer tokens. Each test user (`alice`, `bob`, …) maps to its own
application user under issuer `urn:griplock:local-dev-identity`, so it never
collides with a real customer account.

```powershell
$env:PGPASSWORD = '<local admin password>'
$env:PGAPP_PASSWORD = '<32+ character local app-role password>'
docker compose up -d postgres     # loopback-only PostgreSQL 16
npm run build
npm run dev:server                # migrates, then serves http://127.0.0.1:8080
```

Open `http://127.0.0.1:8080` and sign in as any test user. For hot reload, also
run `$env:GRIPLOCK_DEV_API='http://127.0.0.1:8080'; npm run dev`.

`dev:server` migrates with the admin login and then serves as the non-superuser
`griplock_app` role, so cross-user access tests hit real row-level security.

Tokens for API tools (curl, Burp, ZAP):

```powershell
$alice = (Invoke-RestMethod -Method Post http://127.0.0.1:8080/dev-auth/token `
  -ContentType 'application/json' -Body '{"user":"alice"}').access_token
# Token without the delegated scope, for 403 tests:
$noScope = (Invoke-RestMethod -Method Post http://127.0.0.1:8080/dev-auth/token `
  -ContentType 'application/json' -Body '{"user":"alice","scope":""}').access_token
Invoke-RestMethod http://127.0.0.1:8080/api/v1/discs -Headers @{ Authorization = "Bearer $alice" }
```

Activation requires `GRIPLOCK_DEV_AUTH=local-only` exactly. The server refuses
to start if:

- `NODE_ENV=production` (always set in the shipped container image);
- it detects Azure Container Apps, App Service or Kubernetes;
- real customer identity variables are also configured;
- it would listen on a non-loopback address.

`/dev-auth/token` also returns 404 for non-loopback clients, and deployments
never set the flag. Unit tests check these guards and confirm dev tokens are
rejected by servers configured for customer identity.

The shared **dev** app instead supports a passcode-protected test login. This is
explicitly restricted to the dev deployment and uses the same token verification
and database RLS as local/customer login. Never enable test login on live.
The passcode is supplied through the dev app's secret, not browser runtime
configuration, source code or test output.

## Evidence and final acceptance

Local/browser fixtures exercise the real MSAL authorization redirect, code flow,
S256 PKCE, requested API scope, state/nonce, callback cancellation and API-backed
screen loading. Real PostgreSQL tests verify signed API tokens, wrong
audience/expiry, scope denials, all feature relationships, ownership/RLS,
transaction context isolation, persistence and token-gated anonymous sale links.

Production acceptance on 2026-10-24 used release `40041880597` (source
`a62b109`): the owner completed Google sign-in with a passkey in normal Edge
and reached the authenticated inventory. The owner confirmed that the session
survived a page refresh. Anonymous session/inventory requests and malformed
tokens returned 401; the production test-login endpoint returned 404. No
inventory data was changed. Logout was not exercised because the owner chose
to remain signed in.

If an embedded browser preview does not expose the user's passkey, open the
application origin in their normal browser and start a fresh sign-in there.
Do not copy an in-progress authorization/callback URL between browsers: its
state and PKCE verifier belong to the browser that started the request.

For future identity changes, repeat an owner-assisted browser check with a
dedicated account: sign in with Google, confirm the API-mapped identity, reload
and sign out. Keep automated wrong-audience, expiry, scope and cross-user
denial coverage separate from evidence of a real provider sign-in.
CAPTCHA/MFA/consent cannot be bypassed. Never upload tokens, browser storage or
real identity-provider traces to public CI evidence.

Existing-provider data transfer is intentionally out of scope.
