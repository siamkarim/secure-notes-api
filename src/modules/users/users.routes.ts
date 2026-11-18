import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import type { Types } from 'mongoose';
import { badRequest, notFound, unauthorized } from '../../lib/errors.js';
import {
  idParams,
  interest,
  interests,
  limit,
  name,
  pageQuery,
  password,
  toPage,
} from '../../lib/validation.js';
import { usersByInterestPipeline, userPostsPipeline } from './users.aggregations.js';
import { currentUser, requireAuth } from '../../middleware/auth.js';
import { User, USER_PUBLIC_FIELDS } from '../../models/user.model.js';
import { issueTokens } from '../auth/auth.routes.js';

// Only these fields can be changed by the user. email and role are admin-only.
const updateMeBody = z
  .strictObject({
    name: name.optional(),
    interests: interests.optional(),
    currentPassword: z.string().min(1).max(128).optional(),
    newPassword: password.optional(),
  })
  .refine((b) => !b.newPassword || b.currentPassword, {
    message: 'currentPassword is required to set a new password',
    path: ['currentPassword'],
  });

const byInterestQuery = z.strictObject({
  limit,
  cursor: interest.optional(), // last interest name of the previous page
  interest: interest.optional(), // show only this interest
});

export const usersRouter = Router();

// Scenario 1: users grouped by interest. Exactly one aggregate() call, nothing else.
usersRouter.get('/by-interest', requireAuth, async (req, res) => {
  const query = byInterestQuery.parse(req.query);

  const groups = await User.aggregate<{
    _id: string;
    count: number;
    users: { _id: Types.ObjectId; name: string }[];
  }>(usersByInterestPipeline({ limit: query.limit, after: query.cursor, only: query.interest }));

  const page = toPage(groups, query.limit);
  res.json({
    items: page.items.map((g) => ({ interest: g._id, count: g.count, users: g.users })),
    nextCursor: page.nextCursor,
  });
});

// Scenario 2: posts of one user. Public, single aggregation with $lookup.
usersRouter.get('/:id/posts', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { limit: pageSize, cursor } = pageQuery.parse(req.query);

  const [result] = await User.aggregate<{
    _id: Types.ObjectId;
    name: string;
    posts: { _id: Types.ObjectId; title: string; body: string; createdAt: Date }[];
  }>(userPostsPipeline({ userId: id, limit: pageSize, cursor }));
  if (!result) throw notFound('User');

  res.json({ user: { _id: result._id, name: result.name }, ...toPage(result.posts, pageSize) });
});

usersRouter.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(currentUser(req).id).select(USER_PUBLIC_FIELDS).lean();
  if (!user) throw unauthorized();
  res.json({ user });
});

usersRouter.patch('/me', requireAuth, async (req, res) => {
  const body = updateMeBody.parse(req.body);
  const { id } = currentUser(req);

  const set: Record<string, unknown> = {};
  if (body.name !== undefined) set.name = body.name;
  if (body.interests !== undefined) set.interests = body.interests;

  let passwordChanged = false;
  if (body.newPassword) {
    const existing = await User.findById(id).select('+passwordHash').lean();
    if (!existing || !(await verifyPassword(existing.passwordHash, body.currentPassword ?? ''))) {
      throw badRequest('Current password is incorrect');
    }
    set.passwordHash = await hashPassword(body.newPassword);
    passwordChanged = true;
  }

  const user = await User.findByIdAndUpdate(
    id,
    // A password change revokes every token issued before it.
    { $set: set, ...(passwordChanged ? { $inc: { tokenVersion: 1 } } : {}) },
    { returnDocument: 'after', runValidators: true },
  )
    .select(`${USER_PUBLIC_FIELDS} tokenVersion`)
    .lean();
  if (!user) throw unauthorized();

  const { tokenVersion, ...safeUser } = user;
  // Keep the current session alive after a password change by issuing fresh tokens.
  const accessToken = passwordChanged ? issueTokens(res, { _id: user._id, tokenVersion }) : undefined;
  res.json({ user: safeUser, accessToken });
});
