/**
 * Adds demo users (with interests), notes and posts so the app and
 * `npm run explain` have something to show. Safe to run more than once.
 *
 * All demo users share the password in SEED_DEMO_PASSWORD (default below).
 */
import { env, isProd } from '../config/env.js';
import { connectDb, disconnectDb } from '../db.js';
import { hashPassword } from '../lib/password.js';
import { Note } from '../models/note.model.js';
import { Post } from '../models/post.model.js';
import { User } from '../models/user.model.js';

const INTERESTS = ['chess', 'reading', 'music', 'cooking', 'football', 'travel', 'photography'];
const USER_COUNT = 30;

const password = process.env.SEED_DEMO_PASSWORD ?? (isProd ? undefined : 'demo-password-123');
if (!password || password.length < 8) {
  console.error('Set SEED_DEMO_PASSWORD (at least 8 characters) to seed a production database.');
  process.exit(1);
}

await connectDb(env.MONGODB_URI);
const passwordHash = await hashPassword(password);

let created = 0;
for (let i = 1; i <= USER_COUNT; i++) {
  const email = `demo${i}@example.com`;
  if (await User.exists({ email })) continue;

  // Every fifth user has no interests, the rest have two or three.
  const interests =
    i % 5 === 0 ? [] : [...new Set([INTERESTS[i % 7]!, INTERESTS[(i * 3) % 7]!, INTERESTS[(i + 4) % 7]!])];

  const user = await User.create({ name: `Demo User ${i}`, email, passwordHash, interests });
  await Note.insertMany(
    Array.from({ length: 6 }, (_, n) => ({
      owner: user._id,
      title: `Note ${n + 1} of ${user.name}`,
      body: 'A private note only its owner (and admins, read-only) can see.',
    })),
  );
  await Post.insertMany(
    Array.from({ length: 4 }, (_, n) => ({
      author: user._id,
      title: `Post ${n + 1} by ${user.name}`,
      body: 'A public post that everyone can read.',
    })),
  );
  created += 1;
}

console.log(`Demo data ready: ${created} new users (login: demo1@example.com ... demo${USER_COUNT}@example.com).`);
await disconnectDb();
