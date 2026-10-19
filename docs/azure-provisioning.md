# Azure Provisioning Runbook — proispro (Phase 1)

Reproducible provisioning for the Azure target architecture in
`docs/adr-azure-entra-rebuild.md`: **Static Web Apps (SPA + Entra EasyAuth)** →
**Container Apps API** → **Azure SQL serverless**, with **ACR**, a
**user-assigned managed identity**, and a **Log Analytics** workspace.

This is Infrastructure-as-Code authoring. Nothing here deploys automatically;
run the commands below when you have Azure credentials. Be honest with yourself:
the **Entra app registration** and the **SQL identity grant** are manual, one-time
steps that Bicep cannot (cleanly) express.

---

## 1. Prerequisites

| Tool | Why | Install |
|---|---|---|
| Azure CLI (`az`) ≥ 2.60 | deployments, SWA, ACA, SQL | <https://learn.microsoft.com/cli/azure/install-azure-cli> |
| Bicep CLI | compile/validate IaC (`az bicep install`) | bundled with `az` |
| Azure Developer CLI (`azd`) | one-command `up`/`down` | <https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd> |
| Docker | build the API image | <https://docs.docker.com/get-docker/> |

```bash
az login
az account set --subscription "<subscription-id>"
az bicep version        # confirm Bicep is present
az extension add --name staticwebapp --upgrade
```

Validate the IaC compiles before anything else:

```bash
az bicep build --file infra/main.bicep   # must exit 0, no errors
```

---

## 2. Entra ID app registration (manual — do this first)

The SWA uses Entra ID (EasyAuth) for sign-in. Create **one app registration** for
the SPA/API. (A second "API" app registration is only needed if you take the
MSAL/path-2 auth fallback from the ADR §2.5 — not the default.)

```bash
# 2.1 Create the app registration
appId=$(az ad app create \
  --display-name "proispro" \
  --sign-in-audience AzureADMyOrg \
  --query appId -o tsv)
echo "AAD App (client) id: $appId"

# 2.2 Add the SWA redirect URI (use your real SWA hostname once known)
az ad app update --id "$appId" \
  --web-redirect-uris "https://<your-swa-hostname>/.auth/login/aad/callback"

# 2.3 Create a client secret for the SWA AAD provider
az ad app credential reset --id "$appId" --display-name "swa-easyauth" \
  --years 1 --query password -o tsv    # store as SWA app setting (step 4)
```

### Expose an API scope (for the path-2 MSAL fallback only)

```bash
# Set an Application ID URI, then add a delegated scope "access_as_user".
az ad app update --id "$appId" --identifier-uris "api://$appId"
# Add the oauth2PermissionScopes via the portal (Expose an API) or a manifest patch:
#   scope name: access_as_user, admin consent: "Access proispro as the signed-in user"
```

> Default path (SWA linked backend) needs **no** exposed scope: SWA forwards the
> signed-in principal to the ACA API as `x-ms-client-principal`. Only add the
> scope if you switch the SPA to acquire its own bearer token (MSAL).

### Invite friends as B2B guests

Friends sign in with their own Microsoft accounts via Entra guest (B2B) invites:

```bash
az ad user invite \
  --invited-user-email-address "friend@example.com" \
  --invite-redirect-url "https://<your-swa-hostname>"
# Repeat per friend. Guests appear in your tenant and can sign in to the SWA.
```

---

## 3. Provision the infrastructure

Pick **one** path.

### Path A — azd (recommended)

```bash
azd auth login
azd env new dev
azd env set AZURE_LOCATION westeurope
azd env set SQL_AAD_ADMIN_LOGIN     "you@contoso.com"
azd env set SQL_AAD_ADMIN_OBJECT_ID "<your-entra-object-id>"   # az ad signed-in-user show --query id -o tsv
azd provision      # creates RG + all resources (no app code yet)
azd up             # provision + build/push image + deploy SPA & API
```

### Path B — plain az (no azd)

```bash
az deployment sub create \
  --name proispro-dev \
  --location westeurope \
  --template-file infra/main.bicep \
  --parameters infra/main.parameters.json \
  --parameters environmentName=dev location=westeurope \
               sqlAadAdminLogin="you@contoso.com" \
               sqlAadAdminObjectId="<your-entra-object-id>"
```

Resource names are derived as `rg-proispro-<env>` plus a deterministic token,
so repeated deploys of the same env are idempotent.

Capture the outputs — `API_CONTAINER_APP_NAME`, `AZURE_CONTAINER_REGISTRY_NAME`,
`WEB_STATIC_WEB_APP_NAME`, `SQL_SERVER_FQDN`, `SQL_DATABASE_NAME`,
`API_MANAGED_IDENTITY_NAME` — you need them below.

---

## 4. Configure SWA authentication (Entra provider)

Set the AAD provider app settings on the SWA so EasyAuth can sign users in:

```bash
az staticwebapp appsettings set \
  --name "<WEB_STATIC_WEB_APP_NAME>" \
  --setting-names \
    AZURE_CLIENT_ID="$appId" \
    AZURE_CLIENT_SECRET="<secret-from-2.3>"
```

Ship a `staticwebapp.config.json` with the SPA (Phase 3 — web app concern) that
wires the `azureActiveDirectory` provider, the `openIdIssuer`
(`https://login.microsoftonline.com/<tenant-id>/v2.0`), and route protection.

---

## 5. Wire the SWA linked backend → ACA API

This is what forwards the Entra principal to the API with zero auth code. SWA
must be **Standard** (it is, per `infra/modules/staticwebapp.bicep`).

```bash
az staticwebapp backends link \
  --name "<WEB_STATIC_WEB_APP_NAME>" \
  --backend-resource-id "<API_CONTAINER_APP_RESOURCE_ID>" \
  --backend-region "<location>"
```

After linking, the SPA calls same-origin `/api/*`; SWA proxies to the ACA app
and injects `x-ms-client-principal`. **Lock ACA ingress** so the API is only
reachable through the SWA proxy — never trust that header on a public endpoint.

---

## 6. Post-deploy: grant the ACA managed identity access to Azure SQL

Bicep sets the Entra **admin** on the SQL server but cannot create the contained
database user for the managed identity (that runs *inside* the DB). Connect to
the database **as the Entra admin** (e.g. via `sqlcmd -G`, Azure Data Studio, or
the portal query editor) and run, substituting the managed identity name
(`API_MANAGED_IDENTITY_NAME`, e.g. `id-proispro-<token>`):

```sql
-- Run against the proispro database, authenticated as the Entra admin.
CREATE USER [id-proispro-<token>] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [id-proispro-<token>];
ALTER ROLE db_datawriter ADD MEMBER [id-proispro-<token>];
-- ddl_admin only if the API applies schema/migrations at runtime:
-- ALTER ROLE db_ddladmin ADD MEMBER [id-proispro-<token>];
```

The API then connects with the user-assigned identity (its client id is passed
in as `AZURE_CLIENT_ID`) using an AAD access-token connection — **no password**.

---

## 7. CI/CD (GitHub Actions)

`.github/workflows/azure-deploy.yml` builds the API image → pushes to ACR →
updates the ACA revision, and builds + deploys the SPA to SWA, gated on `main`
via **OIDC** (`azure/login`, no stored credentials).

Configure a federated credential for this repo and add the repo secrets listed
in the workflow header (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
`AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `ACR_NAME`, `ACA_APP_NAME`,
`SWA_DEPLOYMENT_TOKEN`). The CI identity needs **AcrPush** on the ACR and
**Contributor** on the container app (or RG).

```bash
# Example federated credential (branch: main) on the CI app registration:
az ad app federated-credential create --id "<ci-app-id>" --parameters '{
  "name": "proispro-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:<owner>/<repo>:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'

# SWA deployment token:
az staticwebapp secrets list --name "<WEB_STATIC_WEB_APP_NAME>" \
  --query "properties.apiKey" -o tsv
```

> The `api` job auto-skips until `api/Dockerfile` exists (Phase 2 dependency).

---

## 8. What is manual (be honest)

| Step | Why it is manual |
|---|---|
| Entra app registration (§2) | app reg + redirect URIs + guest invites are awkward/unsafe to fully express in Bicep |
| Expose API scope (§2) | only for the MSAL fallback; portal/manifest is clearer |
| SWA auth app settings (§4) | client secret must not live in source/IaC |
| SWA linked backend (§5) | one linked backend per SWA; region-gated; cleanest via CLI post-deploy |
| SQL identity grant (§6) | contained DB user runs inside the database, not in ARM |
| CI federated credential + secrets (§7) | identity/secret bootstrapping is a one-time account setup |

Everything else (Log Analytics, ACA env + app, ACR + AcrPull role, SQL server +
serverless DB + auto-pause, SWA resource, managed identity) is in
`infra/main.bicep` and reproducible with `azd up` / `az deployment sub create`.

---

## 9. Teardown

```bash
azd down --purge            # or: az group delete --name rg-proispro-dev --yes
```
