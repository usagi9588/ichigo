# Ichigo Development Progress

Last updated: 2026-10-23

## Current Plan

A local, single-user job tracker. Keep the existing static frontend; use Node.js, TypeScript, the built-in HTTP server, and SQLite for the backend. Codex operates the browser through Playwright MCP using the skill.

Flow: The user provides a job URL → Codex opens the job and saves a screenshot → the backend stores the job → the user fills out and submits the application manually → the user tells Codex the result → Codex records it and closes the pages associated with this application.

Result rules:

- “Applied, close it”: record Applied, then close the associated pages.
- “Close the page” without stating the result: record Pending, then close the associated pages.
- “Did not apply, close it”: record To Apply, then close the associated pages.
- If saving fails, report it clearly and leave the pages open so the user does not assume the result was recorded.

The backend does not start or manage the Playwright browser and does not continuously monitor page closures. If the user closes a page, the job stage does not change automatically. Implement directly according to this plan without a separate MCP feasibility phase.

## Completed

- [x] Built the static frontend: board, list, search, work mode filters, job details, and job creation.
- [x] Added drag and drop, stage updates, notes, and localStorage persistence for demo data.
- [x] Changed the brand from Orbit to Ichigo and updated the top-left logo to a strawberry.

## 1. Local Backend and Data

- [x] Initialized the Node.js and TypeScript project with development and regular startup commands.
- [x] Created the SQLite database with initialization and version migration.
- [x] Store the job source URL, actual visited URL, company, title, location, work mode, salary, tags, job text, stage, notes, and timestamps.
- [x] Store application records and stage history; support multiple applications for the same job.
- [x] Created a local data directory for the database and screenshots and added version control ignore rules.
- [x] Added endpoints for health checks, job creation and listing, details, field edits, and stage updates.
- [x] Added shared frontend and skill endpoints to start applications, record results, and save screenshots.
- [x] Reuse the existing card for duplicate job URLs; repeated recording of the same result does not append duplicate history.
- [x] The backend serves the static frontend and screenshots and provides stable local board and job detail URLs.
- [x] Bind the service to 127.0.0.1, validate write request origins, restrict screenshot access, and do not expose browser login data.
- [x] Support one-time import of user-created jobs from legacy localStorage, excluding the original 12 demo jobs. Re-imports do not create duplicate cards, and the source data is retained.

## 2. Playwright MCP Application Flow

- [x] Use MCP to open the job page and record its tab and subsequent application popups.
- [x] Extract the company, title, actual URL, and visible job text; allow missing fields to be filled in on the board.
- [x] Save a full-page PNG before the user fills out the application and link it to the job record through the backend.
- [x] Handle page load failures, sign-in walls, and screenshot failures; record the actual screenshot status and allow recapture later.
- [x] Mark the job as Applying and return its board details URL so the user can fill out, upload a resume, and submit manually.
- [x] When the user reports the result, save the stage, application time, and activity history according to the rules above.
- [x] After the data is saved, close only the pages associated with this application and leave other pages open.
- [x] Preserve job IDs and page associations across conversation turns. Identify unclear page associations first and ask the user if they cannot be determined.
- [x] Allow results to be saved based on the user’s report even if the page is closed or the MCP connection is lost; report the page status accurately.
- [x] Support recapturing after sign-in and updating screenshot status in job details.

## 3. Frontend Integration

- [x] Keep the existing HTML, CSS, and visual layout while switching data access to backend APIs; do not rewrite in React.
- [x] Show the real database by default; do not automatically write demo data to the database.
- [x] Connect job creation, search, filters, stage drag and drop, note saving, and the activity timeline.
- [x] Allow missing or incorrectly extracted job fields to be added or edited.
- [x] Replace mock snapshots with real screenshots and job text, support full-page screenshot viewing, and show the actual status when a screenshot is missing.
- [x] Pending jobs support “Confirm Applied,” “Return to To Apply,” and “Archive.”
- [x] Allow setting the actual application time when confirming Applied; default to the confirmation time.
- [x] Refresh data periodically while preserving search filters and notes being edited, so refreshes do not overwrite unsaved input.
- [x] Add empty, loading, save failure, and backend unavailable states; do not show success after a failed write.
- [x] Update the “Apply to This Job” button and recapture entry to show a copyable Codex command with the job ID or URL; the user starts MCP operations in Codex.
- [x] Update prototype copy, storage notes, and workflow documentation; remove claims that closing a window automatically sets Pending.

## 4. Skill and Command Line

- [x] Created the project apply-job skill, supporting job URLs and existing job IDs.
- [x] The skill defines the steps for opening pages with MCP, extraction, screenshots, manual application, result recording, and closing pages.
- [x] Clarified that the user fills out, uploads, and submits manually; the skill does not submit applications automatically.
- [x] Added a CLI script that checks for and starts the local backend as needed, calls endpoints, and outputs structured results.
- [x] Support starting applications, saving screenshots, updating results, and looking up jobs while reusing backend rules.
- [x] Return the job details URL, job ID, screenshot status, and browser operation result.
- [x] Handle invalid URLs, service startup and endpoint failures, duplicate URLs, and unclear page associations.
- [x] Document skill installation and examples, local service startup and shutdown, data backup, and troubleshooting.

## 5. Testing and Acceptance

- [x] Used a local mock recruitment site to verify the full flow: open → screenshot → create job → manual action → report result → save → close associated pages.
- [x] Verified the Applied, unspecified result, and Not Applied rules and actual application time.
- [x] Verified cross-origin redirects, application popups, multiple tabs, and which unrelated pages remain open.
- [x] Verified sign-in walls, page load and screenshot failures, and recapture after sign-in.
- [x] Verified results after early page closure, page association recovery across MCP calls, and result recording after loss of an isolated browser context.
- [ ] Verify recovery after disconnecting and reconnecting the shared MCP transport (the shared connection has not been deliberately disconnected).
- [x] Verified that pages remain open and an error is reported when saving fails.
- [x] Verified URL deduplication, multiple application history, and idempotent result calls.
- [x] Verified that legacy import excludes demo jobs and can be repeated.
- [x] Verified that jobs, notes, screenshots, and history remain accessible after service restart.
- [x] Verified frontend creation, search and filters, drag and drop, result confirmation, screenshot viewing, and automatic refresh.
- [ ] Complete a manual trial on a real website and record any issues.

## Current Acceptance Status and Environment Limits

- Completed the first backend, SQLite, CLI, skill documentation, and frontend API integration; all 11 automated test groups passed.
- After the user ran `npm run e2e:serve`, all 4 checks for the three real CLI/HTTP results and persistence across backend restarts passed. Real MCP, HTTP, and SQLite integration passed 23 checks; cross-call recovery and recovery after losing an isolated browser context passed 4 more, for 27 browser integration checks total.
- This integration run used no mocked APIs. The local recruitment site covered popups, cross-origin navigation, sign-in, recapture, 503 errors, and mock form submission. The production job database was not modified.
- Integration fixes resolved stale open details after button focus and an off-by-one error in the CLI default project root; frontend refreshes continue to preserve active edits.
- The integration board currently runs at `http://127.0.0.1:4184`; mock recruitment pages use ports 4185 and 4186. The isolated test data directory is recorded in `.data/e2e-config.json`. Press Ctrl+C in the user terminal running the integration command to stop the test services.
- The sandbox still cannot listen on ports directly, but the user started the service and completed the integration run, so verified flows are no longer marked as blocked.
- Disconnecting and reconnecting the shared MCP transport and a user-submitted application on a real recruitment website remain unverified and unchecked.
- See `tests/e2e-latest.json` for results and README.md for operation and reproduction steps.
- The skill is in `skills/apply-job`. AGENTS.md provides the project route, and README.md documents global symlink installation. The global skills directory was not modified.

## Implementation Order and Scope

Proceed in this order: backend and database → MCP flow and skill → frontend integration → full acceptance. Check off tasks as they are completed.

The first version does not include automatic form filling or submission, bulk collection, multi-device sync, backend browser control, or automatic result detection when a page closes.

This document replaces the plan.md proposal for direct backend Playwright control, background session monitoring, and automatic Pending status on page close. Keep the original plan aligned during implementation to avoid conflicting rules.

## Collaboration Rules

- [x] Created AGENTS.md requiring progress updates and a Summary appended to the end of this file after each completed task.

## Summaries

- 2026-10-23 Summary: Created AGENTS.md with per-task progress and summary requirements and recorded the change in progress.md.

- 2026-10-23 Summary: Network restrictions prevented npm downloads, so the first version uses built-in Node.js HTTP and SQLite with no third-party runtime dependencies; the skill is in the writable skills/apply-job directory.

- 2026-10-23 Summary: Completed the zero-dependency Node.js/TypeScript entry point and startup commands and configured local data ignore rules.

- 2026-10-23 Summary: Implemented SQLite v1 migration, job fields, application records, and stage history with multiple applications supported; syntax checks passed, with behavior tests to follow.

- 2026-10-23 Summary: Backend APIs and SQLite behavior passed 6 test groups covering deduplication, repeat applications, idempotent results, imports, screenshot access, and origin validation.

- 2026-10-23 Summary: Completed the apply-job skill and JSON CLI; 8 backend/CLI test groups and skill validation passed. MCP page closing and background startup integration remained pending environment access.

- 2026-10-23 Summary: Switched frontend reads and writes to real APIs, removed demo jobs and mock screenshots, and added field editing, application confirmation, command copying, and legacy import; syntax checks passed, with browser acceptance to follow.

- 2026-10-23 Summary: Completed startup, shutdown, skill installation, legacy migration, backup, and API documentation and updated plan.md to the MCP approach.

- 2026-10-23 Summary: Completed 17 UI checks with Playwright MCP and controlled API data, covering creation, field edits, note-save retry, filters, application time, refresh protection, and drag and drop; fixed a refresh race.

- 2026-10-23 Summary: Completed legacy job activity import and in-project skill routing; 8 backend/CLI test groups continued to pass, and strict type checking used the local TypeScript cache.

- 2026-10-23 Summary: Final browser regression passed 21 checks (31 controlled API requests, no unhandled JS errors), covering real PNG rendering, pending return/archive actions, and unsaved field protection.

- 2026-10-23 Summary: Preserved the target stage when adding from each board column; jobs added in Applying are first saved as To Apply, with browser actions started by Codex. New-stage creation and 9 backend/CLI test groups passed.

- 2026-10-23 Summary: The user started the isolated integration environment. Real CLI/HTTP checks passed for applied, pending, and saved outcomes, screenshot import, result idempotency, and SQLite persistence after automatic restart; real MCP opened the board.

- 2026-10-23 Summary: Real MCP/HTTP completed job extraction, full-page screenshot association through SQLite, cross-origin application popups and redirects, mock form submission, closing only associated pages after saving, and preserving pages on failure. Integration found that open details did not refresh after button focus; a fix was underway.

- 2026-10-23 Summary: Real HTTP, SQLite, and MCP integration passed 23 checks. Recapture after sign-in, preserving old screenshots after load failure, and recording results after early page closure all passed. Fixed stale details after focus and the CLI project root path; 11 automated test groups passed.

- 2026-10-23 Summary: Restored page markers from SQLite across two MCP calls and saved a Pending result after closing the isolated browser context; all 4 checks passed. The shared MCP transport was not deliberately disconnected.

- 2026-10-23 Summary: Saved real integration results in tests/e2e-latest.json with reproduction steps. Confirmed 4 real CLI checks, 27 real browser checks, and 11 automated test groups passed; added mock site type declarations, and strict type and syntax checks passed.

- 2026-10-23 Summary: Created the initial repository commit after checking for sensitive data; it included 24 frontend, backend, skill, test, and integration record files.

- 2026-10-23 Summary: Translated all repository content into English; repository-wide Chinese-character scan found none, `npm run check` passed, and all 11 automated test groups passed.
