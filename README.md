# Stack Health

A small static Stack Health project that generates a JSON report of package versions and exposes a simple UI to view them.

How it works

- `stack-list.json` contains a curated list of packages and their declared/current versions.
- `node scripts/check-stack.js` queries the npm registry for the latest versions, checks the local runtime environment, and writes `public/stack-health.json`.
- `node scripts/server.js` serves `public/` on port `5001` so you can open `http://localhost:5001` and inspect the report.

The report now includes runtime checks for Node.js 22 and optional checks for Docker and PostgreSQL CLI availability.

The UI highlights missing runtime dependencies clearly and summarizes issues at the top of the page.

If the report shows `psql` as missing, install the PostgreSQL client locally so the development stack can be fully validated. On Ubuntu, run `sudo apt-get install postgresql-client`; on macOS, use `brew install libpq` and add it to your PATH.

On Windows you can use the included helper to get a one-line install command (uses `winget` or `choco` if available):

```powershell
# shows recommended command
powershell -ExecutionPolicy Bypass -File scripts/install-psql-windows.ps1

# to run the installer command (requires elevation)
powershell -ExecutionPolicy Bypass -File scripts/install-psql-windows.ps1 -Install
```

Quick start

```bash
# run the checker (writes public/stack-health.json)
node scripts/check-stack.js

# serve the UI
node scripts/server.js

# open http://localhost:5001
```

CI

A GitHub Actions workflow (see `.github/workflows/stack-health.yml`) can be configured to run the checker on a schedule and commit updates to `public/stack-health.json` so the UI always shows a recent snapshot.
