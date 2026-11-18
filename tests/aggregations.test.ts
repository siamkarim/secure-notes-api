import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, bearer, createUser, useTestDb } from './helpers.js';

useTestDb();

type Group = { interest: string; count: number; users: { _id: string; name: string }[] };

describe('scenario 1: users grouped by interest', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/users/by-interest')).status).toBe(401);
  });

  it('groups users under each of their interests, A to Z', async () => {
    const a = await createUser('user', { interests: ['chess', 'reading'] });
    const b = await createUser('user', { interests: ['chess'] });
    const c = await createUser('user', { interests: [] });

    const res = await request(app).get('/api/users/by-interest').set(bearer(a.token));
    const groups: Group[] = res.body.items;

    expect(res.status).toBe(200);
    expect(groups.map((g) => [g.interest, g.count])).toEqual([
      ['chess', 2],
      ['reading', 1],
    ]);
    expect(groups[0]!.users.map((u) => u._id).sort()).toEqual([a.id, b.id].sort());
    expect(groups[1]!.users.map((u) => u._id)).toEqual([a.id]);

    // Only id and name are exposed; a user with no interests appears nowhere.
    expect(Object.keys(groups[0]!.users[0]!).sort()).toEqual(['_id', 'name']);
    expect(JSON.stringify(groups)).not.toContain(c.id);
  });

  it('pages through the groups with a cursor', async () => {
    const { token } = await createUser('user', { interests: ['art', 'chess', 'music'] });
    await createUser('user', { interests: ['chess', 'zen'] });

    const page1 = await request(app).get('/api/users/by-interest?limit=2').set(bearer(token));
    expect(page1.body.items.map((g: Group) => g.interest)).toEqual(['art', 'chess']);
    expect(page1.body.nextCursor).toBe('chess');

    const page2 = await request(app)
      .get('/api/users/by-interest?limit=2&cursor=chess')
      .set(bearer(token));
    expect(page2.body.items.map((g: Group) => [g.interest, g.count])).toEqual([
      ['music', 1],
      ['zen', 1],
    ]);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('can show a single interest', async () => {
    const { token } = await createUser('user', { interests: ['chess', 'music'] });
    await createUser('user', { interests: ['Chess'] });

    const res = await request(app).get('/api/users/by-interest?interest=CHESS').set(bearer(token));
    expect(res.body.items.map((g: Group) => [g.interest, g.count])).toEqual([['chess', 2]]);
  });
});

describe('scenario 2: posts of a user ($lookup)', () => {
  it('is public and returns the user with their posts, newest first, paged', async () => {
    const alice = await createUser();
    const bob = await createUser();
    for (const title of ['P1', 'P2', 'P3']) {
      await request(app).post('/api/posts').set(bearer(alice.token)).send({ title, body: 'hello' });
    }
    await request(app).post('/api/posts').set(bearer(bob.token)).send({ title: 'Bob', body: 'x' });

    const page1 = await request(app).get(`/api/users/${alice.id}/posts?limit=2`);
    expect(page1.status).toBe(200);
    expect(page1.body.user).toEqual({ _id: alice.id, name: expect.any(String) });
    expect(page1.body.items.map((p: { title: string }) => p.title)).toEqual(['P3', 'P2']);

    const page2 = await request(app).get(
      `/api/users/${alice.id}/posts?limit=2&cursor=${page1.body.nextCursor}`,
    );
    expect(page2.body.items.map((p: { title: string }) => p.title)).toEqual(['P1']);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('returns an empty list for a user without posts and 404 for an unknown user', async () => {
    const alice = await createUser();

    const empty = await request(app).get(`/api/users/${alice.id}/posts`);
    expect(empty.body.items).toEqual([]);

    const missing = await request(app).get('/api/users/000000000000000000000000/posts');
    expect(missing.status).toBe(404);
  });

  it('only logged-in users can write posts', async () => {
    const res = await request(app).post('/api/posts').send({ title: 't', body: 'b' });
    expect(res.status).toBe(401);
  });
});
