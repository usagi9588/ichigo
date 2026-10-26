# 🍓 Ichigo

A local job tracker. SQLite stores jobs, application records, notes, and activity history; PNG files store job snapshots. Codex operates the browser through Playwright MCP, and you submit applications manually.

## Start

Requires Node.js 24 or later. There are no third-party runtime dependencies, so `npm install` is not required.

```sh
cd /Users/hhhcccyyy/ichigo
npm start
```

Open http://127.0.0.1:4174. Use this URL for the frontend; do not open `index.html` directly.

Start, check, and stop the background service:

```sh
npm run cli -- serve
npm run cli -- status
npm run cli -- stop
```

By default, data is stored in `.data/ichigo.sqlite`, PNG and PDF captures in `.data/screenshots/`, and service logs in `.data/server.log`. Set `ICHIGO_PORT` to change the port or `ICHIGO_DATA_DIR` to use another data directory (an absolute path is recommended). Use the same configuration when starting the service and calling the CLI.

If the Codex sandbox reports `listen EPERM`, run the startup command in a local terminal. The service binds only to 127.0.0.1.

## Install the project skill

The skill is at [skills/apply-job/SKILL.md](skills/apply-job/SKILL.md). The current environment cannot write to the project `.agents` directory or the global skills directory. The repository includes the complete skill; in a local terminal you can create a symlink to it. Check for an existing directory with the same name first; do not overwrite it.

```sh
mkdir -p ~/.codex/skills
ln -s /Users/hhhcccyyy/ichigo/skills/apply-job ~/.codex/skills/apply-job
```

Reopen your Codex session or refresh the skill list, and make sure Playwright MCP is connected. You can also ask Codex to read the SKILL.md above and use it directly without installing. If you copy the skill instead of symlinking it, set `ICHIGO_ROOT` to the project path.

## Workflow

Tell Codex:

```text
Use Ichigo's apply-job skill to apply for this job: https://example.com/jobs/123
```

Codex creates the job and application record, opens a separate tab, extracts job information, and first attempts a full-page PNG screenshot. If it fails, Codex retries once; if both attempts fail, it uses native Playwright MCP `browser_pdf_save` to save a PDF. You then fill out, upload your resume, and submit manually. The Apply button in job details generates a copyable Codex command.

Afterward, tell Codex:

- “Applied, close it”: record Applied, then close the pages associated with this application.
- “Close the page”: record Pending if you have not stated the result.
- “Did not apply, close it”: return the job to To Apply.

If saving fails, the page stays open. Closing it yourself does not change the stage. MCP manages application pages; the backend does not monitor page closures. Restarting the backend does not end an unfinished application. Continue through Codex or record the result in job details.

To recapture, say “Recapture a full-page screenshot for job 123.” This does not create an application or change the stage. Recapture uses the same sequence: full-page PNG, one retry on failure, then native `browser_pdf_save`. Both tools must return a local file path readable by the CLI. If PDF generation or import fails, record a failure status and preserve any previous capture. PNG and PDF files may each be up to 12 MB. PDF captures appear as “Job PDF” with an “Open PDF” link; print pagination and styling may differ from the screen. Sign-in walls remain blocked until you sign in and request recapture.

Enable the native PDF tool by adding `"--caps=pdf"` to the Playwright MCP server arguments (for example, `["@playwright/mcp@latest", "--caps=pdf"]`), then restart or reconnect the MCP server. If the tool is unavailable, Codex reports the fallback failure.

The CLI can also manage data directly:

```sh
npm run cli -- start 'https://example.com/jobs/123'
npm run cli -- get 1
npm run cli -- patch 1 --json '{"company":"Acme","title":"AI Engineer"}'
npm run cli -- screenshot 1 --file /absolute/path/capture.png
npm run cli -- screenshot 1 --file /absolute/path/job.pdf
npm run cli -- result 1 --session SESSION_ID --result applied
npm run cli -- help
```

The CLI starts the local service as needed and outputs JSON; failures return a nonzero exit code. Recording a result requires the application session ID. Repeating the same result does not duplicate history. Different jobs can have active applications simultaneously, with at most one active session per job. Starting the same job again reuses its active session. Identify the job explicitly or through clear conversation context when reporting a result; Codex asks when the target is ambiguous and never defaults to the newest session. Recording one result leaves other applications and their pages unchanged.

On startup, existing databases migrate transactionally to schema version 2 without changing job, session, page, or history records. Restart an already running backend to load this change. Older backend versions reject version 2 databases; reverting requires a compatible database backup.

## Migrate legacy data

If the frontend finds `orbit-jobs-v1` in this browser origin, it shows an import button. The original 12 demo jobs are excluded. Import success or failure does not delete the source data, and import can be repeated.

Browser storage is isolated by origin. If the old page uses another port or is opened through `file://`, the new service cannot read its data directly. Run the following in the old page's browser console to download a JSON file, then click “Import Legacy Data JSON” in the new board.

```js
const oldJobs = localStorage.getItem('orbit-jobs-v1') || '[]';
const exportUrl = URL.createObjectURL(new Blob([oldJobs], {type: 'application/json'}));
const download = document.createElement('a');
download.href = exportUrl;
download.download = 'ichigo-legacy-jobs.json';
download.click();
setTimeout(() => URL.revokeObjectURL(exportUrl), 1000);
```

## Backup and restore

Stop the foreground service with Ctrl+C or run `npm run cli -- stop`, then copy the entire `.data/` directory. To restore, stop the service first and copy the backup into the data directory. Do not copy only the active SQLite main file, or data in its WAL may be missed. Browser sign-in state belongs to the MCP browser and is not included in this backup.

## API and checks

- `GET /api/health`, `GET /api/jobs`, `GET /api/jobs/:id`
- `POST /api/jobs`, `PATCH /api/jobs/:id`, `POST /api/import`
- `POST /api/jobs/:id/start`, `POST /api/jobs/:id/pages`
- `POST /api/jobs/:id/result`, `POST /api/jobs/:id/screenshot`

Write endpoints accept JSON and can be called by the same-origin frontend. CLI requests require `X-Ichigo-Client: cli`; cross-origin access is not enabled. `pages` accepts `sessionId` and a `pages` array. `result` accepts `sessionId`, `result` (`applied`/`pending`/`saved`), and optional `appliedAt`. Screenshot requests accept exactly one of `pngBase64` or `pdfBase64` for a successful capture, or `status` (`blocked`/`failed`/`missing`) and `error`.

```sh
npm run check
npm test
```

Backend and CLI tests use temporary SQLite databases and the actual request handler without listening on a port. `tests/ui.scenario.mjs` provides UI scenarios for Playwright MCP using controlled API data; it is not a substitute for full HTTP and real recruitment site acceptance. See [progress.md](progress.md) for remaining items.

## Real end-to-end integration

Run this in a local terminal and leave it open:

```sh
npm run e2e:serve
```

This starts an isolated backend on port 4184 and mock recruitment sites on ports 4185 and 4186. It first uses the real CLI to check all three application outcomes, screenshot import, and data persistence after a backend restart. Test data is stored in the isolated `.data/e2e-*` directory; production `.data/ichigo.sqlite` is unaffected. If the default ports are occupied, set `ICHIGO_E2E_PORT` to another value; three consecutive ports are used.

When the terminal reports that the integration environment is running, ask Codex to execute the exported `run(page, config)` from `tests/e2e.scenario.mjs` through Playwright MCP. Read config from `.data/e2e-config.json`. The script uses the real HTTP API and checks job extraction, full-page screenshots, cross-origin navigation and popups, local mock form submission, result recording, closing only associated pages, automatic detail refresh, recapture after sign-in, preservation of the old screenshot on failure, and recording results after early page closure. It does not visit or submit to real recruitment sites.

The latest results are in `tests/e2e-latest.json`: 4 CLI checks and 27 browser checks passed. Recovery checks read page markers from SQLite between two MCP calls and then close an isolated test browser context; the shared MCP transport was not deliberately disconnected. A manual application on a real recruitment site still needs separate acceptance.

Press Ctrl+C to stop the integration command and its test services. Test databases and screenshots are retained for inspection. The production board service is not stopped.
