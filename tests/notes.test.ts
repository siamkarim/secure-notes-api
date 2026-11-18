import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, bearer, createUser, useTestDb } from './helpers.js';
import { Note } from '../src/models/note.model.js';

useTestDb();

async function createNote(token: string, title = 'My note') {
  const res = await request(app).post('/api/notes').set(bearer(token)).send({ title, body: 'text' });
  expect(res.status).toBe(201);
  return res.body.note as { _id: string; owner: string; title: string };
}

describe('notes: owner', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/notes')).status).toBe(401);
    expect((await request(app).post('/api/notes').send({ title: 'x' })).status).toBe(401);
  });

  it('can create, read, update and delete their own note', async () => {
    const { token, id } = await createUser();
    const note = await createNote(token);
    expect(note.owner).toBe(id);

    const read = await request(app).get(`/api/notes/${note._id}`).set(bearer(token));
    expect(read.body.note.title).toBe('My note');

    const updated = await request(app)
      .patch(`/api/notes/${note._id}`)
      .set(bearer(token))
      .send({ title: 'Renamed' });
    expect(updated.body.note.title).toBe('Renamed');

    const removed = await request(app).delete(`/api/notes/${note._id}`).set(bearer(token));
    expect(removed.status).toBe(204);
    expect(await Note.countDocuments()).toBe(0);
  });

  it('cannot set the owner of a note', async () => {
    const alice = await createUser();
    const bob = await createUser();

    const res = await request(app)
      .post('/api/notes')
      .set(bearer(alice.token))
      .send({ title: 'x', owner: bob.id });
    expect(res.status).toBe(400);
  });

  it('lists only their own notes, newest first, page by page', async () => {
    const alice = await createUser();
    const bob = await createUser();
    for (let i = 1; i <= 5; i++) await createNote(alice.token, `A${i}`);
    await createNote(bob.token, 'B1');

    const page1 = await request(app).get('/api/notes?limit=2').set(bearer(alice.token));
    expect(page1.body.items.map((n: { title: string }) => n.title)).toEqual(['A5', 'A4']);
    expect(page1.body.nextCursor).toEqual(expect.any(String));

    const page2 = await request(app)
      .get(`/api/notes?limit=2&cursor=${page1.body.nextCursor}`)
      .set(bearer(alice.token));
    expect(page2.body.items.map((n: { title: string }) => n.title)).toEqual(['A3', 'A2']);

    const page3 = await request(app)
      .get(`/api/notes?limit=2&cursor=${page2.body.nextCursor}`)
      .set(bearer(alice.token));
    expect(page3.body.items.map((n: { title: string }) => n.title)).toEqual(['A1']);
    expect(page3.body.nextCursor).toBeNull();
  });

  it('rejects invalid pagination input', async () => {
    const { token } = await createUser();
    for (const query of ['limit=0', 'limit=101', 'limit=abc', 'cursor=not-an-id', 'cursor[$gt]=']) {
      const res = await request(app).get(`/api/notes?${query}`).set(bearer(token));
      expect(res.status, query).toBe(400);
    }
  });
});

describe('notes: other users', () => {
  it("a user cannot read, update or delete someone else's note (404, not 403)", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const note = await createNote(alice.token);

    const read = await request(app).get(`/api/notes/${note._id}`).set(bearer(bob.token));
    const update = await request(app)
      .patch(`/api/notes/${note._id}`)
      .set(bearer(bob.token))
      .send({ title: 'hacked' });
    const remove = await request(app).delete(`/api/notes/${note._id}`).set(bearer(bob.token));

    expect([read.status, update.status, remove.status]).toEqual([404, 404, 404]);
    expect((await Note.findById(note._id).lean())?.title).toBe('My note');
  });

  it("an admin can view anyone's note but cannot change or delete it", async () => {
    const alice = await createUser();
    const admin = await createUser('admin');
    const note = await createNote(alice.token);

    const read = await request(app).get(`/api/notes/${note._id}`).set(bearer(admin.token));
    const update = await request(app)
      .patch(`/api/notes/${note._id}`)
      .set(bearer(admin.token))
      .send({ title: 'edited by admin' });
    const remove = await request(app).delete(`/api/notes/${note._id}`).set(bearer(admin.token));

    expect([read.status, update.status, remove.status]).toEqual([200, 404, 404]);
  });

  it('an admin has their own notes like any user', async () => {
    const alice = await createUser();
    const admin = await createUser('admin');
    await createNote(alice.token);
    await createNote(admin.token, 'Admin note');

    const mine = await request(app).get('/api/notes').set(bearer(admin.token));
    expect(mine.body.items.map((n: { title: string }) => n.title)).toEqual(['Admin note']);
  });
});
