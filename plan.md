# Ichigo: Codex-Initiated Applications and Local Job Tracker

This plan reflects the latest agreement. See [progress.md](progress.md) for tasks and acceptance status.

## Current workflow

The user provides a job URL → Codex uses the apply-job skill and local backend to create a record → Playwright MCP opens a separate job tab, extracts details, and saves a full-page PNG → the user fills out, uploads a resume, and submits manually → the user tells Codex the result → Codex records the result and closes pages associated with this application.

When the user confirms the application was submitted, record Applied. If they ask only to close the page without stating the result, record Pending. If they did not apply, return the job to To Apply. If saving fails, keep the page open. Closing a page manually does not update the stage.

## Implementation

- Keep the existing static HTML, CSS, and JavaScript frontend and connect it to real APIs; no React rewrite is needed.
- Use local Node.js 24+, TypeScript, the built-in HTTP server, and built-in SQLite, with no third-party runtime dependencies. Fastify was originally planned, but dependency downloads were restricted, so the first version uses built-in HTTP.
- SQLite stores jobs, application sessions, page associations, notes, and activity history; PNG files store screenshots.
- The backend serves data APIs, screenshots, and the frontend. It does not start or control Playwright or monitor page closure.
- The apply-job skill and CLI start the service and record jobs and application results. Codex uses Playwright MCP for browser operations.
- Stages are To Apply, Applying, Pending, Applied, Interview, Offer, Rejected, and Archived. Reuse the same job for duplicate URLs and retain multiple application records. Only one application may be active at a time in the first version.
- Designed for a single local user; the service binds to 127.0.0.1. Automatic form filling, submission, bulk collection, and multi-device sync are out of scope.

See [README.md](README.md) for installation, startup, migration, and backup instructions.
