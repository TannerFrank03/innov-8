import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';

const H = { 'X-Requested-With': 'innov8' };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i8-share-'));
let n = 0;
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let app, owner, board, other, task;

async function register(name, email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').set(H).send({ name, email, password: 'password123' }).expect(201);
  return Object.assign(agent, { user: res.body.user, joined: res.body.joined });
}

beforeEach(async () => {
  app = createApp(await openDatabase({ url: `file:${path.join(tmp, `s${++n}.db`)}` }));
  owner = request.agent(app);
  await owner.post('/api/auth/setup').set(H).send({ name: 'Tanner', email: 'tanner@example.com', password: 'password123' }).expect(201);
  board = (await owner.post('/api/boards').set(H).send({ name: 'SAICRA' }).expect(201)).body;
  other = (await owner.post('/api/boards').set(H).send({ name: 'Secret client' }).expect(201)).body;
  task = (await owner.post(`/api/boards/${board.id}/tasks`).set(H).send({ title: 'Homepage' }).expect(201)).body;
});

describe('project IDs', () => {
  it('gives each board a stable PRJ code that can be looked up and searched', async () => {
    expect(board.code).toBe('PRJ-0001');
    expect(other.code).toBe('PRJ-0002');
    expect((await owner.get('/api/boards/code/prj-0002').expect(200)).body).toEqual({ id: other.id });
    const hits = (await owner.get('/api/search?q=PRJ-0001').expect(200)).body;
    expect(hits[0]).toMatchObject({ kind: 'board', board_id: board.id, board_code: 'PRJ-0001' });
  });
});

describe('guests', () => {
  it('see nothing until a project is shared with them', async () => {
    const guest = await register('Client', 'client@example.com');
    expect(guest.user.guest).toBe(true);
    expect((await guest.get('/api/boards').expect(200)).body).toEqual([]);
    await guest.get(`/api/boards/${board.id}`).expect(404);
    await guest.get(`/api/tasks/${task.id}`).expect(404);
    await guest.patch(`/api/tasks/${task.id}`).set(H).send({ title: 'Hacked' }).expect(404);
    await guest.get('/api/boards/code/PRJ-0001').expect(404);
    await guest.post('/api/boards').set(H).send({ name: 'Mine' }).expect(403);
    expect((await guest.get('/api/search?q=Home').expect(200)).body).toEqual([]);
  });

  it('cannot register twice or before the studio exists', async () => {
    await register('Client', 'client@example.com');
    await request(app).post('/api/auth/register').set(H).send({ name: 'X', email: 'CLIENT@example.com', password: 'password123' }).expect(400);
  });
});

describe('sharing by email', () => {
  it('adds an existing guest as an editor who can edit tasks but not manage the project', async () => {
    const guest = await register('Mholi', 'mholi@example.com');
    const res = await owner.post(`/api/boards/${board.id}/invites`).set(H).send({ email: 'Mholi@example.com', role: 'editor' }).expect(201);
    expect(res.body.added).toMatchObject({ name: 'Mholi', role: 'editor' });

    expect((await guest.get('/api/boards').expect(200)).body.map((b) => b.id)).toEqual([board.id]);
    const data = (await guest.get(`/api/boards/${board.id}`).expect(200)).body;
    expect(data.access).toBe('editor');
    expect(data.people.map((p) => [p.name, p.board_role])).toEqual([['Tanner', 'team'], ['Mholi', 'editor']]);
    await guest.patch(`/api/tasks/${task.id}`).set(H).send({ title: 'Homepage v2', assignee_id: guest.user.id }).expect(200);
    await guest.post(`/api/boards/${board.id}/tasks`).set(H).send({ title: 'New one' }).expect(201);

    await guest.get(`/api/boards/${board.id}/sharing`).expect(403);
    await guest.post(`/api/boards/${board.id}/invites`).set(H).send({}).expect(403);
    await guest.patch(`/api/boards/${board.id}`).set(H).send({ archived: true }).expect(403);
    await guest.get(`/api/boards/${other.id}`).expect(404);
    expect((await guest.get('/api/my-tasks').expect(200)).body.map((t) => t.title)).toEqual(['Homepage v2']);
  });

  it('lets a viewer read and comment but not change anything', async () => {
    const guest = await register('Client', 'client@example.com');
    await owner.post(`/api/boards/${board.id}/invites`).set(H).send({ email: 'client@example.com', role: 'viewer' }).expect(201);
    expect((await guest.get(`/api/boards/${board.id}`).expect(200)).body.access).toBe('viewer');
    await guest.get(`/api/tasks/${task.id}`).expect(200);
    await guest.post(`/api/tasks/${task.id}/comments`).set(H).send({ body: 'Love it' }).expect(201);
    await guest.patch(`/api/tasks/${task.id}`).set(H).send({ title: 'No' }).expect(403);
    await guest.post(`/api/boards/${board.id}/tasks`).set(H).send({ title: 'No' }).expect(403);
    await guest.post(`/api/tasks/${task.id}/subtasks`).set(H).send({ title: 'No' }).expect(403);
    await guest.post(`/api/boards/${board.id}/statuses`).set(H).send({ name: 'No', color: '#111111' }).expect(403);
  });

  it('invites someone who has not registered yet, and joins them when they sign up', async () => {
    const res = await owner.post(`/api/boards/${board.id}/invites`).set(H).send({ email: 'new@example.com', role: 'viewer' }).expect(201);
    expect(res.body.invite).toMatchObject({ email: 'new@example.com', role: 'viewer' });
    const info = (await request(app).get(`/api/invites/${res.body.invite.token}`).expect(200)).body;
    expect(info).toMatchObject({ board_name: 'SAICRA', board_code: 'PRJ-0001', inviter: 'Tanner', role: 'viewer' });

    const guest = await register('New Person', 'NEW@example.com');
    expect(guest.joined).toEqual([board.id]);
    expect((await guest.get(`/api/boards/${board.id}`).expect(200)).body.access).toBe('viewer');
    // Used up: the invite no longer shows as pending.
    expect((await owner.get(`/api/boards/${board.id}/sharing`).expect(200)).body.invites).toEqual([]);
  });

  it('refuses to share with studio team members, who already see everything', async () => {
    await owner.post('/api/users').set(H).send({ name: 'Designer', email: 'd@example.com', password: 'password123' }).expect(201);
    await owner.post(`/api/boards/${board.id}/invites`).set(H).send({ email: 'd@example.com' }).expect(400);
  });
});

describe('invite links', () => {
  it('lets anyone with an account join until the link is switched off', async () => {
    const { invite } = (await owner.post(`/api/boards/${board.id}/invites`).set(H).send({ role: 'editor' }).expect(201)).body;
    expect(invite.email).toBeNull();
    const a = await register('A', 'a@example.com');
    expect((await a.post(`/api/invites/${invite.token}/accept`).set(H).expect(200)).body).toEqual({ board_id: board.id });
    expect((await a.get(`/api/boards/${board.id}`).expect(200)).body.access).toBe('editor');

    await owner.delete(`/api/invites/${invite.id}`).set(H).expect(204);
    const b = await register('B', 'b@example.com');
    await b.post(`/api/invites/${invite.token}/accept`).set(H).expect(404);
    await request(app).get(`/api/invites/${invite.token}`).expect(404);
    await b.get(`/api/boards/${board.id}`).expect(404);
  });

  it('keeps an email invite for that address only', async () => {
    const { invite } = (await owner.post(`/api/boards/${board.id}/invites`).set(H).send({ email: 'right@example.com' }).expect(201)).body;
    const wrong = await register('Wrong', 'wrong@example.com');
    const res = await wrong.post(`/api/invites/${invite.token}/accept`).set(H).expect(403);
    expect(res.body.detail).toMatch(/right@example.com/);
  });

  it('never downgrades an editor who opens a view-only link', async () => {
    const guest = await register('G', 'g@example.com');
    await owner.post(`/api/boards/${board.id}/invites`).set(H).send({ email: 'g@example.com', role: 'editor' }).expect(201);
    const { invite } = (await owner.post(`/api/boards/${board.id}/invites`).set(H).send({ role: 'viewer' }).expect(201)).body;
    await guest.post(`/api/invites/${invite.token}/accept`).set(H).expect(200);
    expect((await guest.get(`/api/boards/${board.id}`).expect(200)).body.access).toBe('editor');
  });
});

describe('managing access', () => {
  it('changes roles, removes people (unassigning their cards) and promotes guests to the team', async () => {
    const guest = await register('G', 'g@example.com');
    await owner.post(`/api/boards/${board.id}/invites`).set(H).send({ email: 'g@example.com', role: 'editor' }).expect(201);
    await owner.patch(`/api/tasks/${task.id}`).set(H).send({ assignee_id: guest.user.id }).expect(200);

    await owner.patch(`/api/boards/${board.id}/members/${guest.user.id}`).set(H).send({ role: 'viewer' }).expect(204);
    expect((await guest.get(`/api/boards/${board.id}`).expect(200)).body.access).toBe('viewer');

    await owner.delete(`/api/boards/${board.id}/members/${guest.user.id}`).set(H).expect(204);
    await guest.get(`/api/boards/${board.id}`).expect(404);
    expect((await owner.get(`/api/tasks/${task.id}`).expect(200)).body.task.assignee_id).toBeNull();

    // A guest can't be assigned work on a project they can't see.
    await owner.patch(`/api/tasks/${task.id}`).set(H).send({ assignee_id: guest.user.id }).expect(400);

    await owner.patch(`/api/users/${guest.user.id}`).set(H).send({ guest: false }).expect(200);
    expect((await guest.get('/api/boards').expect(200)).body).toHaveLength(2);
    await guest.patch(`/api/users/${guest.user.id}`).set(H).send({ role: 'owner' }).expect(403);
  });

  it('shows a guest only the people they work with', async () => {
    const g1 = await register('G1', 'g1@example.com');
    await register('G2', 'g2@example.com');
    await owner.post(`/api/boards/${board.id}/invites`).set(H).send({ email: 'g1@example.com' }).expect(201);
    expect((await g1.get('/api/users').expect(200)).body.map((u) => u.name)).toEqual(['Tanner', 'G1']);
    expect((await owner.get('/api/users').expect(200)).body.map((u) => [u.name, u.guest])).toEqual([
      ['Tanner', false], ['G1', true], ['G2', true],
    ]);
  });
});
