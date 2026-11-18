import { afterAll, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { connectDb, disconnectDb } from '../src/db.js';
import { User, type Role } from '../src/models/user.model.js';

export const app = createApp();
export const PASSWORD = 'correct-horse-battery';

/** Starts an in-memory MongoDB for the test file and empties it before every test. */
export function useTestDb() {
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await connectDb(mongo.getUri());
  });

  beforeEach(async () => {
    const collections = await mongoose.connection.db!.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  });

  afterAll(async () => {
    await disconnectDb();
    await mongo.stop();
  });
}

let counter = 0;

/** Registers a user through the API and returns their id and access token. */
export async function createUser(role: Role = 'user', extra: { interests?: string[] } = {}) {
  counter += 1;
  const email = `user${counter}@example.com`;

  const registered = await request(app)
    .post('/api/auth/register')
    .send({ name: `User ${counter}`, email, password: PASSWORD, ...extra });
  if (registered.status !== 201) throw new Error(`register failed: ${registered.text}`);

  const id: string = registered.body.user._id;
  if (role === 'user') return { id, email, token: registered.body.accessToken as string };

  // Admins cannot be created through public registration; promote directly in the database.
  await User.updateOne({ _id: id }, { $set: { role: 'admin' } });
  const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return { id, email, token: login.body.accessToken as string };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
