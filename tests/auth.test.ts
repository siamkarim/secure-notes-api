import { describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app, bearer, createUser, PASSWORD, useTestDb } from './helpers.js';
import { User } from '../src/models/user.model.js';

useTestDb();

const newUser = { name: 'Alice', email: 'alice@example.com', password: PASSWORD };

describe('register', () => {
  it('creates a user, returns a token and never exposes the hash', async () => {
    const res = await request(app).post('/api/auth/register').send(newUser);

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: 'alice@example.com', role: 'user' });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.user).not.toHaveProperty('tokenVersion');

    const stored = await User.findOne({ email: newUser.email }).select('+passwordHash').lean();
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('sets an httpOnly, SameSite=Strict refresh cookie scoped to /api/auth', async () => {
    const res = await request(app).post('/api/auth/register').send(newUser);
    const cookie = String(res.headers['set-cookie']);

    expect(cookie).toContain('refresh_token=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/auth');
  });

  it('rejects an attempt to register as admin', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...newUser, role: 'admin' });

    expect(res.status).toBe(400);
    expect(await User.countDocuments()).toBe(0);
  });

  it('rejects a duplicate email, case-insensitively', async () => {
    await request(app).post('/api/auth/register').send(newUser);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...newUser, email: 'ALICE@example.com' });

    expect(res.status).toBe(409);
  });

  it('rejects weak passwords and invalid emails', async () => {
    const weak = await request(app).post('/api/auth/register').send({ ...newUser, password: 'short' });
    const bad = await request(app).post('/api/auth/register').send({ ...newUser, email: 'nope' });

    expect(weak.status).toBe(400);
    expect(bad.status).toBe(400);
  });
});

describe('login', () => {
  it('gives the same answer for a wrong password and an unknown email', async () => {
    await request(app).post('/api/auth/register').send(newUser);

    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email: newUser.email, password: 'wrong-password-123' });
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: PASSWORD });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('rejects operator injection in the email field', async () => {
    await request(app).post('/api/auth/register').send(newUser);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: { $ne: null }, password: PASSWORD });

    expect(res.status).toBe(400);
  });
});

describe('access tokens', () => {
  it('rejects missing, malformed and wrongly signed tokens', async () => {
    const { id } = await createUser();
    const forged = jwt.sign({ tv: 0 }, 'some-other-secret-some-other-secret-000', {
      subject: id,
      issuer: 'secure-notes-api',
      audience: 'secure-notes:access',
    });
    const unsigned = jwt.sign({ tv: 0 }, '', {
      algorithm: 'none',
      subject: id,
      issuer: 'secure-notes-api',
      audience: 'secure-notes:access',
    });

    for (const headers of [{}, bearer('garbage'), bearer(forged), bearer(unsigned)]) {
      const res = await request(app).get('/api/users/me').set(headers);
      expect(res.status).toBe(401);
    }
  });

  it('does not accept a refresh token as an access token', async () => {
    const res = await request(app).post('/api/auth/register').send(newUser);
    const refresh = /refresh_token=([^;]+)/.exec(String(res.headers['set-cookie']))![1]!;

    const me = await request(app).get('/api/users/me').set(bearer(refresh));
    expect(me.status).toBe(401);
  });

  it('stops working as soon as the user is deleted', async () => {
    const { id, token } = await createUser();
    await User.deleteOne({ _id: id });

    const res = await request(app).get('/api/users/me').set(bearer(token));
    expect(res.status).toBe(401);
  });
});

describe('refresh and logout', () => {
  it('refresh issues a new access token from the cookie', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send(newUser);

    const res = await agent.post('/api/auth/refresh');
    expect(res.status).toBe(200);

    const me = await request(app).get('/api/users/me').set(bearer(res.body.accessToken));
    expect(me.body.user.email).toBe(newUser.email);
  });

  it('refresh without a cookie is rejected', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('logout revokes both the access token and the refresh token', async () => {
    const agent = request.agent(app);
    const registered = await agent.post('/api/auth/register').send(newUser);
    const oldCookie = String(registered.headers['set-cookie']).split(';')[0]!;

    expect((await agent.post('/api/auth/logout')).status).toBe(204);

    const me = await request(app).get('/api/users/me').set(bearer(registered.body.accessToken));
    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', oldCookie);
    expect(me.status).toBe(401);
    expect(refresh.status).toBe(401);
  });
});

describe('profile', () => {
  it('updates name and interests (normalised and de-duplicated)', async () => {
    const { token } = await createUser();
    const res = await request(app)
      .patch('/api/users/me')
      .set(bearer(token))
      .send({ name: 'New Name', interests: [' Chess ', 'chess', 'Reading'] });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: 'New Name', interests: ['chess', 'reading'] });
  });

  it('does not let a user change their own role or email', async () => {
    const { token } = await createUser();
    const role = await request(app).patch('/api/users/me').set(bearer(token)).send({ role: 'admin' });
    const email = await request(app).patch('/api/users/me').set(bearer(token)).send({ email: 'x@y.com' });

    expect(role.status).toBe(400);
    expect(email.status).toBe(400);
  });

  it('changing the password needs the current one and revokes old tokens', async () => {
    const { token, email } = await createUser();
    const newPassword = 'a-brand-new-password';

    const wrong = await request(app)
      .patch('/api/users/me')
      .set(bearer(token))
      .send({ currentPassword: 'not-my-password', newPassword });
    expect(wrong.status).toBe(400);

    const changed = await request(app)
      .patch('/api/users/me')
      .set(bearer(token))
      .send({ currentPassword: PASSWORD, newPassword });
    expect(changed.status).toBe(200);

    const oldToken = await request(app).get('/api/users/me').set(bearer(token));
    const newToken = await request(app).get('/api/users/me').set(bearer(changed.body.accessToken));
    const oldLogin = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    const newLogin = await request(app).post('/api/auth/login').send({ email, password: newPassword });

    expect(oldToken.status).toBe(401);
    expect(newToken.status).toBe(200);
    expect(oldLogin.status).toBe(401);
    expect(newLogin.status).toBe(200);
  });
});
