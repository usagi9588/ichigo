import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const stages = ['saved','applying','pending','applied','interview','offer','rejected','archived'] as const;
export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export type JobInput = Record<string, unknown>;
export type Session = { id: string; jobId: number; startedAt: string; endedAt: string | null; result: string | null; appliedAt: string | null; pages: unknown[] };
export type Job = {
  id: number; url: string; actualUrl: string; company: string; title: string; location: string;
  mode: string; salary: string; tag: string; text: string; stage: string; notes: string;
  logo: string; color: string; createdAt: string; updatedAt: string; appliedAt: string | null;
  screenshotStatus: string; screenshotError: string; screenshot: string | null;
  history: { text: string; time: string }[]; sessions: Session[];
};
const now = () => new Date().toISOString();
export function url(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('Provide a job URL');
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error();
    u.hash = '';
    return u.href;
  } catch { throw new AppError('Enter a valid http or https job URL'); }
}
function text(value: unknown, limit = 100000): string {
  if (typeof value !== 'string' || value.length > limit) throw new AppError('Field must be a string within the length limit');
  return value.trim();
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new AppError('Invalid application time');
  return new Date(value).toISOString();
}
export class Store {
  db: DatabaseSync;
  directory: string;
  constructor(directory: string) {
    this.directory = directory;
    mkdirSync(join(directory, 'screenshots'), { recursive: true });
    this.db = new DatabaseSync(join(directory, 'ichigo.sqlite'));
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    const version = Number((this.db.prepare('PRAGMA user_version').get() as {user_version: number}).user_version);
    if (version > 1) { this.db.close(); throw new Error('Database version is newer than this program. Upgrade Ichigo'); }
    if (version === 0) this.db.exec(`BEGIN;
      CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
      CREATE TABLE history (id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id), text TEXT NOT NULL, time TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id), started_at TEXT NOT NULL, ended_at TEXT, result TEXT, applied_at TEXT, pages TEXT NOT NULL DEFAULT '[]');
      CREATE UNIQUE INDEX one_active_session ON sessions((1)) WHERE ended_at IS NULL;
      CREATE TABLE imports (source_key TEXT PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id));
      PRAGMA user_version=1; COMMIT;`);
  }
  close() { this.db.close(); }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  event(id: number, value: string) { this.db.prepare('INSERT INTO history(job_id,text,time) VALUES(?,?,?)').run(id, value, now()); }
  list(): Job[] { return this.db.prepare('SELECT id FROM jobs ORDER BY id DESC').all().map(r => this.get(Number(r.id))); }
  get(id: number): Job {
    const row = this.db.prepare('SELECT data FROM jobs WHERE id=?').get(id);
    if (!row) throw new AppError('Job not found', 404);
    const job = JSON.parse(String(row.data));
    job.history = this.db.prepare('SELECT text,time FROM history WHERE job_id=? ORDER BY id').all(id);
    job.sessions = this.db.prepare('SELECT * FROM sessions WHERE job_id=? ORDER BY started_at DESC,rowid DESC').all(id).map(r => this.sessionRow(r));
    return job;
  }
  sessionRow(r: Record<string, unknown>): Session {
    return { id: String(r.id), jobId: Number(r.job_id), startedAt: String(r.started_at), endedAt: r.ended_at as string | null,
      result: r.result as string | null, appliedAt: r.applied_at as string | null, pages: JSON.parse(String(r.pages)) };
  }
  save(job: Job) {
    const { history, sessions, ...data } = job;
    this.db.prepare('UPDATE jobs SET url=?,data=? WHERE id=?').run(job.url, JSON.stringify(data), job.id);
  }
  create(input: JobInput): { job: Job; created: boolean } {
    const source = url(input.url);
    const existing = this.db.prepare('SELECT id FROM jobs WHERE url=?').get(source);
    if (existing) return { job: this.get(Number(existing.id)), created: false };
    return this.transaction(() => {
      const time = now();
      const job = { url: source, actualUrl: '', company: '', title: '', location: '', mode: '', salary: '', tag: '', text: '', stage: 'saved', notes: '',
        logo: '🍓', color: '#eee8fa', createdAt: time, updatedAt: time, appliedAt: null,
        screenshotStatus: 'missing', screenshotError: '', screenshot: null };
      const result = this.db.prepare('INSERT INTO jobs(url,data) VALUES(?,?)').run(source, JSON.stringify(job));
      const id = Number(result.lastInsertRowid);
      this.db.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify({ ...job, id }), id);
      this.event(id, 'Job added');
      this.patchInternal(id, input, false);
      return { job: this.get(id), created: true };
    });
  }
  patch(id: number, input: JobInput): Job { return this.transaction(() => this.patchInternal(id, input)); }
  patchInternal(id: number, input: JobInput, record = true): Job {
    const job = this.get(id); const before = JSON.stringify(job);
    const fields = ['company','title','location','mode','salary','tag','text','notes'] as const;
    for (const key of fields) if (input[key] !== undefined) job[key] = text(input[key]);
    if (input.url !== undefined) {
      const source = url(input.url);
      const duplicate = this.db.prepare('SELECT id FROM jobs WHERE url=? AND id<>?').get(source, id);
      if (duplicate) throw new AppError('This URL already belongs to another job', 409);
      job.url = source;
    }
    if (input.actualUrl !== undefined) job.actualUrl = input.actualUrl === '' ? '' : url(input.actualUrl);
    if (input.stage !== undefined) {
      if (!stages.includes(input.stage as typeof stages[number])) throw new AppError('Invalid job stage');
      const active = job.sessions.find(s => !s.endedAt);
      if (active && input.stage !== 'applying') throw new AppError('Record the current application result first', 409);
      if (input.stage === 'applying' && !active) throw new AppError('Start the application through Codex', 409);
      job.stage = String(input.stage);
      if (job.stage === 'applied' && !job.appliedAt) job.appliedAt = now();
    }
    if (input.appliedAt !== undefined) job.appliedAt = timestamp(input.appliedAt);
    job.logo = job.company ? [...job.company][0].toUpperCase() : '🍓';
    if (JSON.stringify(job) !== before) {
      job.updatedAt = now(); this.save(job);
      if (record) this.event(id, input.stage === undefined ? 'Updated job information or notes' : 'Stage changed to ' + job.stage);
    }
    return this.get(id);
  }
  start(id: number): { job: Job; session: Session; reused: boolean } {
    return this.transaction(() => {
      const job = this.get(id);
      const active = this.db.prepare('SELECT * FROM sessions WHERE ended_at IS NULL').get();
      if (active) {
        if (Number(active.job_id) !== id) throw new AppError('Another job application is active. Record its result first', 409);
        return { job, session: this.sessionRow(active), reused: true };
      }
      const sessionId = randomUUID();
      this.db.prepare('INSERT INTO sessions(id,job_id,started_at) VALUES(?,?,?)').run(sessionId, id, now());
      job.stage = 'applying'; job.updatedAt = now(); this.save(job); this.event(id, 'Application started through Codex');
      const updated = this.get(id);
      return { job: updated, session: updated.sessions.find(s => s.id === sessionId)!, reused: false };
    });
  }
  pages(id: number, input: JobInput): Session {
    if (!Array.isArray(input.pages) || input.pages.length > 30) throw new AppError('Invalid page list');
    const pages = input.pages.map(p => {
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw new AppError('Invalid page record');
      const item = p as JobInput;
      return { url: url(item.url), title: text(item.title ?? '', 1000), marker: text(item.marker ?? '', 200) };
    });
    const row = this.db.prepare('SELECT * FROM sessions WHERE id=? AND job_id=?').get(String(input.sessionId), id);
    if (!row) throw new AppError('Application session not found', 404);
    if (row.ended_at) throw new AppError('Application session has ended; page records cannot be changed', 409);
    this.db.prepare('UPDATE sessions SET pages=? WHERE id=?').run(JSON.stringify(pages), String(input.sessionId));
    return { ...this.sessionRow(row), pages };
  }
  finish(id: number, input: JobInput): Job {
    if (!['applied','pending','saved'].includes(String(input.result))) throw new AppError('Result must be applied, pending, or saved');
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM sessions WHERE id=? AND job_id=?').get(String(input.sessionId), id);
      if (!row) throw new AppError('Application session not found', 404);
      if (row.ended_at) {
        if (row.result !== input.result || (input.appliedAt !== undefined && timestamp(input.appliedAt) !== row.applied_at)) throw new AppError('A different result is already recorded. Change the stage on the board', 409);
        return this.get(id);
      }
      const time = now(); const applied = input.result === 'applied' ? (input.appliedAt === undefined ? time : timestamp(input.appliedAt)) : null;
      this.db.prepare('UPDATE sessions SET ended_at=?,result=?,applied_at=? WHERE id=?').run(time, String(input.result), applied, String(input.sessionId));
      const job = this.get(id); job.stage = String(input.result); job.updatedAt = time;
      if (applied) job.appliedAt = applied;
      this.save(job); this.event(id, input.result === 'applied' ? 'User confirmed application' : input.result === 'saved' ? 'User confirmed not applied; returned to To Apply' : 'Application page closed; result pending confirmation');
      return this.get(id);
    });
  }
  screenshot(id: number, input: JobInput): Job {
    const job = this.get(id);
    const status = input.status ?? 'ready';
    if (!['ready','failed','blocked','missing'].includes(String(status))) throw new AppError('Invalid screenshot status');
    let filename: string | null = null;
    if (status === 'ready') {
      if (typeof input.pngBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.pngBase64)) throw new AppError('Provide PNG data in Base64 format');
      const bytes = Buffer.from(input.pngBase64, 'base64');
      if (bytes.length > 12 * 1024 * 1024 || bytes.length < 33 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a' || bytes.subarray(12,16).toString() !== 'IHDR') throw new AppError('Screenshot must be a PNG no larger than 12 MB');
      filename = `${id}-${randomUUID()}.png`;
      writeFileSync(join(this.directory, 'screenshots', filename), bytes, { flag: 'wx' });
    }
    try {
      return this.transaction(() => {
        job.screenshotStatus = String(status); job.screenshotError = text(input.error ?? '', 2000);
        if (filename) job.screenshot = '/screenshots/' + filename;
        job.updatedAt = now(); this.save(job); this.event(id, status === 'ready' ? 'Saved full-page job screenshot' : 'Screenshot status: ' + status);
        return this.get(id);
      });
    } catch (e) { if (filename) unlinkSync(join(this.directory, 'screenshots', filename)); throw e; }
  }
  importLegacy(input: JobInput) {
    if (!Array.isArray(input.jobs) || input.jobs.length > 1000) throw new AppError('Invalid import data. Up to 1,000 jobs may be imported at once');
    let imported = 0, skipped = 0; const errors: {id: unknown; error: string}[] = [];
    for (const value of input.jobs) {
      if (!value || typeof value !== 'object') { errors.push({id: null, error: 'Invalid job'}); continue; }
      const old = value as JobInput;
      if (!Number.isSafeInteger(old.id) || Number(old.id) <= 12) { skipped++; continue; }
      const key = `orbit-jobs-v1:${old.id}`;
      if (this.db.prepare('SELECT 1 FROM imports WHERE source_key=?').get(key)) { skipped++; continue; }
      try {
        const result = this.create({ ...old, stage: old.stage === 'applying' ? 'pending' : old.stage });
        this.transaction(() => {
          if (result.created && Array.isArray(old.history)) {
            for (const value of old.history.slice(0,1000)) {
              if (!value || typeof value !== 'object') continue;
              const event = value as JobInput;
              if (typeof event.text !== 'string' || typeof event.time !== 'string') continue;
              this.db.prepare('INSERT INTO history(job_id,text,time) VALUES(?,?,?)').run(result.job.id,text(event.text,10000),event.time.slice(0,200));
            }
            this.event(result.job.id,'Imported jobs and activity history from browser');
          }
          this.db.prepare('INSERT INTO imports(source_key,job_id) VALUES(?,?)').run(key, result.job.id);
        });
        imported++;
      } catch (e) { errors.push({id: old.id, error: (e as Error).message}); }
    }
    return { imported, skipped, errors };
  }
}
