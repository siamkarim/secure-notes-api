import { Router } from 'express';
import { z } from 'zod';
import { badRequest, notFound } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import {
  email,
  idParams,
  interests,
  name,
  objectId,
  olderThan,
  pageQuery,
  password,
  toPage,
} from '../../lib/validation.js';
import { currentUser, requireAuth, requireRole } from '../../middleware/auth.js';
import { Note } from '../../models/note.model.js';
import { Post } from '../../models/post.model.js';
import { ROLES, User, USER_PUBLIC_FIELDS } from '../../models/user.model.js';

const role = z.enum(ROLES);

const createUserBody = z.strictObject({
  name,
  email,
  password,
  role: role.default('user'),
  interests: interests.default([]),
});

const updateUserBody = z
  .strictObject({
    name: name.optional(),
    email: email.optional(),
    password: password.optional(),
    role: role.optional(),
    interests: interests.optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Nothing to update' });

const notesQuery = pageQuery.extend({ owner: objectId.optional() });

export const adminRouter = Router();
// Every route below needs a valid token AND the admin role.
adminRouter.use(requireAuth, requireRole('admin'));

// ---- Users ----------------------------------------------------------------

// List all users, newest first. Sorted and paged by _id, so the default _id index is enough.
adminRouter.get('/users', async (req, res) => {
  const { limit, cursor } = pageQuery.parse(req.query);

  const rows = await User.find(olderThan(cursor))
    .sort({ _id: -1 })
    .limit(limit + 1)
    .select(USER_PUBLIC_FIELDS)
    .lean();

  res.json(toPage(rows, limit));
});

adminRouter.post('/users', async (req, res) => {
  const body = createUserBody.parse(req.body);

  const created = await User.create({
    name: body.name,
    email: body.email,
    passwordHash: await hashPassword(body.password),
    role: body.role,
    interests: body.interests,
  });

  const user = await User.findById(created._id).select(USER_PUBLIC_FIELDS).lean();
  res.status(201).json({ user });
});

adminRouter.get('/users/:id', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const user = await User.findById(id).select(USER_PUBLIC_FIELDS).lean();
  if (!user) throw notFound('User');
  res.json({ user });
});

adminRouter.patch('/users/:id', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = updateUserBody.parse(req.body);

  // An admin cannot demote themselves, so the system can never lose its last admin this way.
  if (body.role && body.role !== 'admin' && id.equals(currentUser(req).id)) {
    throw badRequest('You cannot remove your own admin role');
  }

  const { password: newPassword, ...fields } = body;
  const set: Record<string, unknown> = { ...fields };
  if (newPassword) set.passwordHash = await hashPassword(newPassword);

  // Changing the role or password revokes the tokens that user already holds.
  const revoke = body.role !== undefined || newPassword !== undefined;

  const user = await User.findByIdAndUpdate(
    id,
    { $set: set, ...(revoke ? { $inc: { tokenVersion: 1 } } : {}) },
    { returnDocument: 'after', runValidators: true },
  )
    .select(USER_PUBLIC_FIELDS)
    .lean();
  if (!user) throw notFound('User');

  res.json({ user });
});

adminRouter.delete('/users/:id', async (req, res) => {
  const { id } = idParams.parse(req.params);
  if (id.equals(currentUser(req).id)) throw badRequest('You cannot delete your own account');

  // Delete the user first so their tokens stop working at once, then their data.
  // Both deleteMany calls use the { owner | author: 1, _id: -1 } index prefix.
  const result = await User.deleteOne({ _id: id });
  if (result.deletedCount === 0) throw notFound('User');
  await Promise.all([Note.deleteMany({ owner: id }), Post.deleteMany({ author: id })]);

  res.status(204).end();
});

// ---- Notes ----------------------------------------------------------------

// View everyone's notes, newest first.
//   no filter  -> default _id index
//   ?owner=id  -> { owner: 1, _id: -1 }
adminRouter.get('/notes', async (req, res) => {
  const { limit, cursor, owner } = notesQuery.parse(req.query);

  const rows = await Note.find({ ...(owner ? { owner } : {}), ...olderThan(cursor) })
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate('owner', 'name email') // one extra query: users by _id ($in), index-backed
    .lean();

  res.json(toPage(rows, limit));
});
