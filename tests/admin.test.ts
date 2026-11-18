import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, bearer, createUser, PASSWORD, useTestDb } from './helpers.js';
import { Note } from '../src/models/note.model.js';
import { Post } from '../src/models/post.model.js';
import { User } from '../src/models/user.model.js';

useTestDb();

describe('admin routes: access control', () => {
  const routes: [string, string][] = [
    ['get', '/api/admin/users'],
    ['post', '/api/admin/users'],
    ['get', '/api/admin/users/000000000000000000000000'],
    ['patch', '/api/admin/users/000000000000000000000000'],
    ['delete', '/api/admin/users/000000000000000000000000'],
    ['get', '/api/admin/notes'],
  ];

  it('rejects anonymous requests with 401 and normal users with 403', async () => {
    const { token } = await createUser();
    for (const [method, path] of routes) {
      const call = (headers: Record<string, string>) =>
        (request(app) as any)[method](path).set(headers).send({});

      expect((await call({})).status, `${method} ${path} anonymous`).toBe(401);
      expect((await call(bearer(token))).status, `${method} ${path} user`).toBe(403);
    }
  });
});

describe('admin: manage users', () => {
  it('lists all users with pagination and without secrets', async () => {
    const admin = await createUser('admin');
    await createUser();
    await createUser();

    const page1 = await request(app).get('/api/admin/users?limit=2').set(bearer(admin.token));
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.items[0]).not.toHaveProperty('passwordHash');
    expect(page1.body.items[0]).not.toHaveProperty('tokenVersion');

    const page2 = await request(app)
      .get(`/api/admin/users?limit=2&cursor=${page1.body.nextCursor}`)
      .set(bearer(admin.token));
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('adds a user who can then log in', async () => {
    const admin = await createUser('admin');
    const created = await request(app)
      .post('/api/admin/users')
      .set(bearer(admin.token))
      .send({ name: 'Carol', email: 'carol@example.com', password: PASSWORD, role: 'admin' });

    expect(created.status).toBe(201);
    expect(created.body.user).toMatchObject({ email: 'carol@example.com', role: 'admin' });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'carol@example.com', password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it('fetches and updates a user', async () => {
    const admin = await createUser('admin');
    const user = await createUser();

    const updated = await request(app)
      .patch(`/api/admin/users/${user.id}`)
      .set(bearer(admin.token))
      .send({ name: 'Renamed', interests: ['Chess'] });
    expect(updated.body.user).toMatchObject({ name: 'Renamed', interests: ['chess'] });

    const fetched = await request(app).get(`/api/admin/users/${user.id}`).set(bearer(admin.token));
    expect(fetched.body.user.name).toBe('Renamed');
  });

  it('changing a role takes effect immediately and revokes old tokens', async () => {
    const admin = await createUser('admin');
    const other = await createUser('admin');

    const demoted = await request(app)
      .patch(`/api/admin/users/${other.id}`)
      .set(bearer(admin.token))
      .send({ role: 'user' });
    expect(demoted.status).toBe(200);

    const res = await request(app).get('/api/admin/users').set(bearer(other.token));
    expect(res.status).toBe(401);
  });

  it('an admin cannot demote or delete themselves', async () => {
    const admin = await createUser('admin');

    const demote = await request(app)
      .patch(`/api/admin/users/${admin.id}`)
      .set(bearer(admin.token))
      .send({ role: 'user' });
    const remove = await request(app).delete(`/api/admin/users/${admin.id}`).set(bearer(admin.token));

    expect([demote.status, remove.status]).toEqual([400, 400]);
    expect((await User.findById(admin.id).lean())?.role).toBe('admin');
  });

  it('removing a user also removes their notes and posts, and kills their token', async () => {
    const admin = await createUser('admin');
    const user = await createUser();
    await request(app).post('/api/notes').set(bearer(user.token)).send({ title: 'n' });
    await request(app).post('/api/posts').set(bearer(user.token)).send({ title: 'p', body: 'b' });
    await request(app).post('/api/notes').set(bearer(admin.token)).send({ title: 'keep' });

    const removed = await request(app).delete(`/api/admin/users/${user.id}`).set(bearer(admin.token));
    expect(removed.status).toBe(204);

    expect(await Note.countDocuments({ owner: user.id })).toBe(0);
    expect(await Post.countDocuments({ author: user.id })).toBe(0);
    expect(await Note.countDocuments()).toBe(1);
    expect((await request(app).get('/api/notes').set(bearer(user.token))).status).toBe(401);
  });
});

describe('admin: view notes', () => {
  it("sees everyone's notes, and can filter by owner", async () => {
    const admin = await createUser('admin');
    const alice = await createUser();
    const bob = await createUser();
    await request(app).post('/api/notes').set(bearer(alice.token)).send({ title: 'A1' });
    await request(app).post('/api/notes').set(bearer(bob.token)).send({ title: 'B1' });
    await request(app).post('/api/notes').set(bearer(bob.token)).send({ title: 'B2' });

    const all = await request(app).get('/api/admin/notes').set(bearer(admin.token));
    expect(all.body.items.map((n: { title: string }) => n.title)).toEqual(['B2', 'B1', 'A1']);
    expect(all.body.items[0].owner).toMatchObject({ _id: bob.id, email: bob.email });
    expect(all.body.items[0].owner).not.toHaveProperty('passwordHash');

    const onlyBob = await request(app)
      .get(`/api/admin/notes?owner=${bob.id}&limit=1`)
      .set(bearer(admin.token));
    expect(onlyBob.body.items.map((n: { title: string }) => n.title)).toEqual(['B2']);
    expect(onlyBob.body.nextCursor).toEqual(expect.any(String));
  });
});
