import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';

const H = { 'X-Requested-With': 'innov8' };
let app;
let owner; // supertest agent with a session cookie

// A fresh database file per test (libSQL transactions need a real file, not :memory:).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i8-test-'));
let n = 0;
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function setup() {
  app = createApp(await openDatabase({ url: `file:${path.join(tmp, `t${++n}.db`)}` }));
  owner = request.agent(app);
  await owner.post('/api/auth/setup').set(H).send({ name: 'Tanner', email: 'tanner@example.com', password: 'password123' }).expect(201);
}

async function newBoard(agent = owner) {
  const { body: board } = await agent.post('/api/boards').set(H).send({ name: 'Client work' }).expect(201);
  const { body } = await agent.get(`/api/boards/${board.id}`).expect(200);
  return body;
}

beforeEach(setup);

describe('auth', () => {
  it('only allows first-run setup once', async () => {
    const res = await request(app).post('/api/auth/setup').set(H)
      .send({ name: 'X', email: 'x@example.com', password: 'password123' });
    expect(res.status).toBe(409);
  });

  it('rejects API calls without a session', async () => {
    await request(app).get('/api/boards').expect(401);
  });

  it('rejects writes without the app header (CSRF guard)', async () => {
    await owner.post('/api/boards').send({ name: 'No header' }).expect(403);
  });

  it('signs in with the right password and not the wrong one', async () => {
    await request(app).post('/api/auth/login').set(H).send({ email: 'tanner@example.com', password: 'nope' }).expect(401);
    const res = await request(app).post('/api/auth/login').set(H).send({ email: 'TANNER@example.com', password: 'password123' }).expect(200);
    expect(res.body.user.role).toBe('owner');
  });

  it('lets the owner add a designer who cannot add users', async () => {
    await owner.post('/api/users').set(H).send({ name: 'Designer', email: 'd@example.com', password: 'password123' }).expect(201);
    const designer = request.agent(app);
    await designer.post('/api/auth/login').set(H).send({ email: 'd@example.com', password: 'password123' }).expect(200);
    await designer.post('/api/users').set(H).send({ name: 'Y', email: 'y@example.com', password: 'password123' }).expect(403);
  });

  it('returns field errors in Problem Details format', async () => {
    const res = await owner.post('/api/users').set(H).send({ name: '', email: 'bad', password: 'short' }).expect(400);
    expect(res.body).toMatchObject({ status: 400, title: 'Invalid request' });
    expect(Object.keys(res.body.errors)).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });
});

describe('boards', () => {
  it('creates a board with default statuses, groups and labels', async () => {
    const b = await newBoard();
    expect(b.statuses.map((s) => s.name)).toEqual(['To do', 'In progress', 'Client review', 'Done']);
    expect(b.groups.length).toBe(2);
    expect(b.labels.length).toBeGreaterThan(0);
  });

  it('requires archiving before delete, and moves tasks when a status is deleted', async () => {
    const b = await newBoard();
    const [todo, doing] = b.statuses;
    const { body: t } = await owner.post(`/api/boards/${b.board.id}/tasks`).set(H).send({ title: 'A', status_id: doing.id }).expect(201);
    await owner.delete(`/api/statuses/${doing.id}?moveTo=${todo.id}`).set(H).expect(204);
    const { body: after } = await owner.get(`/api/tasks/${t.id}`).expect(200);
    expect(after.task.status_id).toBe(todo.id);

    await owner.delete(`/api/boards/${b.board.id}`).set(H).expect(400);
    await owner.patch(`/api/boards/${b.board.id}`).set(H).send({ archived: true }).expect(200);
    await owner.delete(`/api/boards/${b.board.id}`).set(H).expect(204);
  });
});

describe('templates', () => {
  it('creates a website project with phases, dated tasks, owners, labels and subtasks', async () => {
    await owner.post('/api/users').set(H).send({ name: 'Designer', email: 'd@example.com', password: 'password123' }).expect(201);
    const { body: list } = await owner.get('/api/templates').expect(200);
    expect(list[0]).toMatchObject({ id: 'website', tasks: 14 });

    const { body: board } = await owner.post('/api/boards').set(H)
      .send({ name: 'Website - Acme', template: 'website', start_date: '2026-11-02' }).expect(201);
    const { body } = await owner.get(`/api/boards/${board.id}`).expect(200);
    expect(body.groups.map((g) => g.name)).toEqual(['Discovery', 'Design', 'Build', 'Review', 'Launch']);
    expect(body.tasks).toHaveLength(14);

    const byTitle = Object.fromEntries(body.tasks.map((t) => [t.title, t]));
    const design = body.groups.find((g) => g.name === 'Design');
    expect(byTitle['Homepage design']).toMatchObject({ start_date: '2026-11-09', due_date: '2026-11-13', group_id: design.id, priority: 'high' });
    expect(byTitle['Go-live support']).toMatchObject({ start_date: '2026-12-22', due_date: '2026-12-23' });
    expect(byTitle['Homepage design'].assignee_id).not.toBe(byTitle['Sitemap'].assignee_id);
    const admin = body.labels.find((l) => l.name === 'Admin');
    expect(byTitle['Design sign-off'].label_ids).toEqual([admin.id]);
    expect(byTitle['Final QA'].subtask_count).toBe(5);
    expect(byTitle['Revisions'].subtask_count).toBe(0);
    expect(body.tasks.every((t) => t.status_id === body.statuses[0].id)).toBe(true);
  });

  it('rejects an unknown template', async () => {
    await owner.post('/api/boards').set(H).send({ name: 'X', template: 'nope' }).expect(400);
  });
});

describe('tasks', () => {
  it('stamps completed_at when moved to Done and clears it when moved back', async () => {
    const b = await newBoard();
    const done = b.statuses.find((s) => s.is_done);
    const { body: t } = await owner.post(`/api/boards/${b.board.id}/tasks`).set(H).send({ title: 'Logo' }).expect(201);
    expect(t.completed_at).toBeNull();
    const { body: moved } = await owner.patch(`/api/tasks/${t.id}`).set(H).send({ status_id: done.id }).expect(200);
    expect(moved.completed_at).toBeTruthy();
    const { body: back } = await owner.patch(`/api/tasks/${t.id}`).set(H).send({ status_id: b.statuses[0].id }).expect(200);
    expect(back.completed_at).toBeNull();
  });

  it('keeps both edits when two saves to the same task overlap', async () => {
    // Simulate a remote database: every read takes a little while, so the saves interleave.
    const slowDb = await openDatabase({ url: `file:${path.join(tmp, `t${++n}.db`)}` });
    const get = slowDb.get.bind(slowDb);
    slowDb.get = async (...a) => { await new Promise((r) => setTimeout(r, 15)); return get(...a); };
    const agent = request.agent(createApp(slowDb));
    await agent.post('/api/auth/setup').set(H).send({ name: 'T', email: 't@example.com', password: 'password123' }).expect(201);
    const { body: board } = await agent.post('/api/boards').set(H).send({ name: 'B' }).expect(201);
    const { body: t } = await agent.post(`/api/boards/${board.id}/tasks`).set(H).send({ title: 'New task' }).expect(201);
    await Promise.all([
      agent.patch(`/api/tasks/${t.id}`).set(H).send({ title: 'Homepage design' }),
      agent.patch(`/api/tasks/${t.id}`).set(H).send({ due_date: '2026-11-13' }),
      agent.patch(`/api/tasks/${t.id}`).set(H).send({ priority: 'high' }),
    ]);
    const { body } = await agent.get(`/api/tasks/${t.id}`).expect(200);
    expect(body.task).toMatchObject({ title: 'Homepage design', due_date: '2026-11-13', priority: 'high' });
  });

  it('rejects a start date after the due date', async () => {
    const b = await newBoard();
    const res = await owner.post(`/api/boards/${b.board.id}/tasks`).set(H)
      .send({ title: 'X', start_date: '2026-12-10', due_date: '2026-12-01' }).expect(400);
    expect(res.body.errors.start_date).toMatch(/before the due date/);
  });

  it('rejects statuses and labels from another board', async () => {
    const a = await newBoard();
    const other = await newBoard();
    await owner.post(`/api/boards/${a.board.id}/tasks`).set(H).send({ title: 'X', status_id: other.statuses[0].id }).expect(400);
    await owner.post(`/api/boards/${a.board.id}/tasks`).set(H).send({ title: 'X', label_ids: [other.labels[0].id] }).expect(400);
  });

  it('stores labels, subtasks and comments and logs activity', async () => {
    const b = await newBoard();
    const me = (await owner.get('/api/auth/state')).body.user;
    const { body: t } = await owner.post(`/api/boards/${b.board.id}/tasks`).set(H)
      .send({ title: 'Brand guide', label_ids: [b.labels[0].id], assignee_id: me.id, due_date: '2026-11-03' }).expect(201);
    expect(t.label_ids).toEqual([b.labels[0].id]);
    await owner.post(`/api/tasks/${t.id}/subtasks`).set(H).send({ title: 'Colours' }).expect(201);
    await owner.post(`/api/tasks/${t.id}/comments`).set(H).send({ body: 'Looks good' }).expect(201);
    await owner.patch(`/api/tasks/${t.id}`).set(H).send({ status_id: b.statuses[1].id }).expect(200);

    const { body } = await owner.get(`/api/tasks/${t.id}`).expect(200);
    expect(body.subtasks).toHaveLength(1);
    expect(body.comments[0].user_name).toBe('Tanner');
    expect(body.activity.map((a) => a.action)).toEqual(expect.arrayContaining(['task.created', 'task.commented', 'task.status']));

    const { body: mine } = await owner.get('/api/my-tasks').expect(200);
    expect(mine.map((x) => x.id)).toContain(t.id);
    const { body: found } = await owner.get('/api/search?q=brand').expect(200);
    expect(found[0].id).toBe(t.id);
  });
});
