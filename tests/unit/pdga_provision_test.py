import importlib.util
import io
import json
import os
import sys
from pathlib import Path
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("provision", Path(__file__).parents[2] / "scripts" / "configure-pdga-dev.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProvisionTests(unittest.TestCase):
    def check_provision(self, stage="dev", event="workflow_dispatch"):
        calls = []
        sha = "a" * 40
        payload = {"properties": {"template": {"containers": [{"name": "app",
            "image": "fixture@sha256:abc", "env": [{"name": "SOURCE_SHA", "value": sha}]}]}}}

        def request(req, timeout):
            calls.append(req)
            if req.method == "POST":
                value = {"value": [{"name": "pg-app", "value": "synthetic-database-only"}]}
            elif req.method == "PATCH":
                value = {}
            elif len(calls) > 3:
                value = {"properties": {"provisioningState": "Succeeded",
                    "latestReadyRevisionName": "app--pdga-123-1"}}
            else:
                value = payload
            return io.BytesIO(json.dumps(value).encode())

        def command(args, **kwargs):
            self.assertNotIn("synthetic-pdga-password", " ".join(args))
            return json.dumps({"accessToken": "synthetic-token"} if "get-access-token" in args else {"id": "fixture-sub"}).encode()

        env = {"GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": event, "PDGA_STAGE": stage,
            "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1", "EXPECTED_SOURCE_SHA": sha,
            "PDGA_USERNAME": "synthetic-user", "PDGA_PASSWORD": "synthetic-pdga-password"}
        if stage == "prod" or event == "workflow_run":
            env.update({"GITHUB_REF": "refs/heads/main",
                "GITHUB_WORKFLOW_REF": "pelsebubben/proispro/.github/workflows/prod.yml@refs/heads/main"})
        output = io.StringIO()
        with patch.dict(os.environ, env, clear=True), patch.object(module.subprocess, "check_output", side_effect=command), \
                patch.object(module.urllib.request, "urlopen", side_effect=request), redirect_stdout(output):
            module.configure()
        self.assertEqual(len(calls), 4)
        target = "app-griplock-dev" if stage == "dev" else "app-griplock-staging"
        self.assertTrue(all("/containerApps/" + target in req.full_url for req in calls))
        self.assertTrue(all(req.full_url.startswith("https://management.azure.com/") for req in calls))
        body = json.loads(calls[2].data)
        secrets = body["properties"]["configuration"]["secrets"]
        self.assertEqual(secrets[0], {"name": "pg-app", "value": "synthetic-database-only"})
        self.assertIn({"name": "pdga-password", "value": "synthetic-pdga-password"}, secrets)
        env = body["properties"]["template"]["containers"][0]["env"]
        self.assertIn({"name": "PDGA_PASSWORD", "secretRef": "pdga-password"}, env)
        self.assertNotIn("synthetic-pdga-password", output.getvalue())
        self.assertNotIn("synthetic-token", output.getvalue())

    def test_dev_secrets_stay_in_memory_and_existing_configuration_survives(self):
        self.check_provision()

    def test_verified_main_release_provisions_production_and_restores_dev(self):
        self.check_provision("prod", "workflow_run")
        self.check_provision("dev", "workflow_run")

    def test_production_rejects_branch_dispatch_and_prs_before_azure_access(self):
        for event in ("pull_request", "workflow_dispatch", "workflow_run"):
            with patch.dict(os.environ, {"GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": event,
                    "PDGA_STAGE": "prod", "GITHUB_REF": "refs/heads/feature"}, clear=True), \
                    patch.object(module.subprocess, "check_output") as command:
                with self.assertRaises(RuntimeError):
                    module.configure()
                command.assert_not_called()

    def test_non_manual_and_missing_secrets_fail_before_azure_access(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(module.subprocess, "check_output") as command:
            with self.assertRaises(RuntimeError):
                module.configure()
            command.assert_not_called()
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "workflow_dispatch"}, clear=True), \
                patch.object(module.subprocess, "check_output") as command:
            with self.assertRaises(RuntimeError):
                module.configure()
            command.assert_not_called()


if __name__ == "__main__":
    unittest.main()
