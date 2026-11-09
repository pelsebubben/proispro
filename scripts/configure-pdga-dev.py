"""Protected GitHub environment provisioning. Never prints ARM bodies or secrets."""
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error

progress_phase = "workflow_guard"


def configure():
    global progress_phase
    stage = os.environ.get("PDGA_STAGE", "dev")
    event = os.environ.get("GITHUB_EVENT_NAME")
    trusted_release = (os.environ.get("GITHUB_REF") == "refs/heads/main" and
        os.environ.get("GITHUB_WORKFLOW_REF") == "pelsebubben/proispro/.github/workflows/prod.yml@refs/heads/main" and
        event in ("workflow_dispatch", "workflow_run"))
    if (os.environ.get("GITHUB_ACTIONS") != "true" or stage not in ("dev", "prod") or
            not (trusted_release or stage == "dev" and event == "workflow_dispatch")):
        raise RuntimeError("Use manual dev provisioning or the protected main release workflow.")
    username = os.environ.get("PDGA_USERNAME", "")
    password = os.environ.get("PDGA_PASSWORD", "")
    index_template = os.environ.get("PDGA_LAYOUT_INDEX_TEMPLATE", "")
    overview_template = os.environ.get("PDGA_EVENT_OVERVIEW_TEMPLATE", "")
    sha = os.environ.get("EXPECTED_SOURCE_SHA", "")
    if not username or not password or not index_template or not overview_template or len(sha) != 40:
        raise RuntimeError("Configure both PDGA secrets in the selected GitHub environment before running.")
    progress_phase = "azure_context"
    account = json.loads(subprocess.check_output(["az", "account", "show", "-o", "json"], stderr=subprocess.DEVNULL))
    progress_phase = "azure_token"
    token = json.loads(subprocess.check_output(
        ["az", "account", "get-access-token", "--resource", "https://management.azure.com/", "-o", "json"],
        stderr=subprocess.DEVNULL))["accessToken"]
    resource = ("https://management.azure.com/subscriptions/" + account["id"] +
                "/resourceGroups/rg-griplock-staging/providers/Microsoft.App/containerApps/" +
                ("app-griplock-dev" if stage == "dev" else "app-griplock-staging"))

    def arm(method, suffix="", body=None):
        request = urllib.request.Request(resource + suffix + "?api-version=2024-03-01",
            data=json.dumps(body).encode() if body is not None else None, method=method,
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read(4 * 1024 * 1024)
            return json.loads(raw) if raw else {}

    progress_phase = "read_app"
    app = arm("GET")
    progress_phase = "validate_app"
    template = app["properties"]["template"]
    containers = template["containers"]
    if len(containers) != 1 or containers[0]["name"] != "app":
        raise RuntimeError("Unexpected application template.")
    env = containers[0]["env"]
    if not any(v.get("name") == "SOURCE_SHA" and v.get("value") == sha for v in env):
        raise RuntimeError("Deploy this exact commit before configuring PDGA credentials.")
    progress_phase = "read_existing_secrets"
    existing = arm("POST", "/listSecrets")["value"]
    protected = {"PDGA_USERNAME": ("pdga-username", username), "PDGA_PASSWORD": ("pdga-password", password),
        "PDGA_LAYOUT_INDEX_TEMPLATE": ("pdga-layout-index", index_template),
        "PDGA_EVENT_OVERVIEW_TEMPLATE": ("pdga-event-overview", overview_template)}
    secrets = [v for v in existing if v["name"] not in [value[0] for value in protected.values()]]
    secrets += [{"name": value[0], "value": value[1]} for value in protected.values()]
    containers[0]["env"] = [v for v in env if v["name"] not in protected] + [
        {"name": name, "secretRef": value[0]} for name, value in protected.items()]
    template["revisionSuffix"] = "pdga-" + os.environ["GITHUB_RUN_ID"] + "-" + os.environ["GITHUB_RUN_ATTEMPT"]
    progress_phase = "write_provider_configuration"
    arm("PATCH", body={"properties": {"configuration": {"secrets": secrets}, "template": template}})
    progress_phase = "wait_ready"
    for _ in range(40):
        updated = arm("GET")["properties"]
        if updated.get("provisioningState") in ("Failed", "Canceled"):
            raise RuntimeError("Credential update failed.")
        if (updated.get("provisioningState") == "Succeeded" and
                updated.get("latestReadyRevisionName", "").endswith("--" + template["revisionSuffix"])):
            print("PDGA credentials configured on the " + stage + " server.")
            return
        time.sleep(10)
    raise RuntimeError("Revision did not become ready before the deadline.")


if __name__ == "__main__":
    try:
        configure()
    except Exception as error:
        # Azure/HTTP errors may embed credentials or full resource bodies.
        status = str(error.code) if isinstance(error, urllib.error.HTTPError) else "unavailable"
        print("PDGA provisioning failed at " + progress_phase + " (HTTP status: " + status +
              "). Check environment secrets, Azure permissions, and the deployed commit. Response details suppressed.",
              file=sys.stderr)
        sys.exit(1)
