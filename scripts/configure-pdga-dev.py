"""Protected GitHub environment provisioning. Never prints ARM bodies or secrets."""
import json
import os
import subprocess
import sys
import time
import urllib.request


def configure():
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
    sha = os.environ.get("EXPECTED_SOURCE_SHA", "")
    if not username or not password or len(sha) != 40:
        raise RuntimeError("Configure both PDGA secrets in the selected GitHub environment before running.")
    account = json.loads(subprocess.check_output(["az", "account", "show", "-o", "json"], stderr=subprocess.DEVNULL))
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

    app = arm("GET")
    template = app["properties"]["template"]
    containers = template["containers"]
    if len(containers) != 1 or containers[0]["name"] != "app":
        raise RuntimeError("Unexpected application template.")
    env = containers[0]["env"]
    if not any(v.get("name") == "SOURCE_SHA" and v.get("value") == sha for v in env):
        raise RuntimeError("Deploy this exact commit before configuring PDGA credentials.")
    existing = arm("POST", "/listSecrets")["value"]
    secrets = [v for v in existing if v["name"] not in ("pdga-username", "pdga-password")]
    secrets += [{"name": "pdga-username", "value": username}, {"name": "pdga-password", "value": password}]
    containers[0]["env"] = [v for v in env if v["name"] not in ("PDGA_USERNAME", "PDGA_PASSWORD")] + [
        {"name": "PDGA_USERNAME", "secretRef": "pdga-username"},
        {"name": "PDGA_PASSWORD", "secretRef": "pdga-password"}]
    template["revisionSuffix"] = "pdga-" + os.environ["GITHUB_RUN_ID"] + "-" + os.environ["GITHUB_RUN_ATTEMPT"]
    arm("PATCH", body={"properties": {"configuration": {"secrets": secrets}, "template": template}})
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
    except Exception:
        # Azure/HTTP errors may embed credentials or full resource bodies.
        print("PDGA provisioning failed. Check environment secrets, Azure permissions, and the deployed commit. Details suppressed.",
              file=sys.stderr)
        sys.exit(1)
