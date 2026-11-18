/**
 * Creates the first admin account (or resets its password and role).
 * Public registration can never create an admin, so this is the only way in.
 *
 *   SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD='...' npm run seed:admin
 */
import { env } from '../config/env.js';
import { connectDb, disconnectDb } from '../db.js';
import { hashPassword } from '../lib/password.js';
import { email as emailSchema, password as passwordSchema } from '../lib/validation.js';
import { User } from '../models/user.model.js';

const email = emailSchema.safeParse(process.env.SEED_ADMIN_EMAIL);
const password = passwordSchema.safeParse(process.env.SEED_ADMIN_PASSWORD);
if (!email.success || !password.success) {
  console.error('Set SEED_ADMIN_EMAIL (valid email) and SEED_ADMIN_PASSWORD (8-128 characters).');
  process.exit(1);
}

await connectDb(env.MONGODB_URI);

await User.updateOne(
  { email: email.data },
  {
    $set: { passwordHash: await hashPassword(password.data), role: 'admin' },
    $setOnInsert: { name: 'Admin', interests: [] },
    $inc: { tokenVersion: 1 }, // revoke any tokens issued with the old password
  },
  { upsert: true },
);

console.log(`Admin account ready: ${email.data}`);
await disconnectDb();
