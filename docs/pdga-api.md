# PDGA API access test

This is a local, read-only connectivity test for an approved PDGA API account.
It does not change Griplock, import PDGA data into SQL, or create a scheduled
integration. A PDGA website browser session is not harvested or exported.

## Run securely

In a private PowerShell terminal, from the repository root:

```powershell
.\scripts\test-pdga.ps1
```

The launcher asks for the username and a hidden password using `Get-Credential`.
Enter credentials only in that prompt, not in chat, command arguments, source
files, environment files, or a recorded/transcribed/debugging PowerShell session.
Node 22 and PowerShell are required; no extra dependencies are needed.

The credentials pass directly to Node over an anonymous stdin pipe. They and
the API cookie/CSRF token exist only in process memory and are never deliberately
saved. JavaScript/.NET strings cannot be guaranteed securely erased from memory;
use a trusted workstation. Do not capture process dumps while testing.

The test calls the documented HTTPS login, searches `country=NO` for Ekeberg,
then requests a sample of at most 10 Norwegian courses. It always attempts API
logout after a valid session, including when a search fails. It neither logs out
the website session nor reads its cookies. Logout failures are explicit.

Output contains only selected course fields and PDGA attribution. It excludes
account details, contact information, passwords, cookies, tokens, and raw API
responses. Errors expose a sanitized status, not server response bodies. Requests
have a 30-second timeout, a 2 MiB response cap, and reject redirects.

An empty search is not proof that a course does not exist. This sample is not a
Norway coverage count. The documented directory API does not establish access to
individual hole layouts, pars, distances, or tee/basket geometry.

## Before persistent integration

Confirm permitted server-side caching, redistribution, refresh frequency, and
commercial use with PDGA. Keep PDGA-derived records/provenance and licence
obligations distinct from the downloadable OSM catalogue; never put PDGA data
into an ODbL export without confirming rights.

For a later scheduled dev integration, credentials belong in an approved Azure
secret store with access limited to the sync worker, not in frontend runtime
configuration or Git. Prefer a dedicated PDGA integration account if PDGA permits
it. That persistent credential storage and cloud configuration are not performed
by this local test.

References: [authentication](https://www.pdga.com/dev/api/rest/v1/auth),
[course service](https://www.pdga.com/dev/api/rest/v1/services#course-search),
[developer programme](https://www.pdga.com/dev).
