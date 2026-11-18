import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { idParams, olderThan, pageQuery, toPage } from '../../lib/validation.js';
import { currentUser, requireAuth } from '../../middleware/auth.js';
import { Note } from '../../models/note.model.js';

const title = z.string().trim().min(1).max(200);
const body = z.string().max(10_000);

// "owner" is never accepted from the client; it always comes from the token.
const createBody = z.strictObject({ title, body: body.default('') });
const updateBody = z
  .strictObject({ title: title.optional(), body: body.optional() })
  .refine((b) => b.title !== undefined || b.body !== undefined, { message: 'Nothing to update' });

export const notesRouter = Router();
notesRouter.use(requireAuth);

// List my own notes, newest first. Index: { owner: 1, _id: -1 }
notesRouter.get('/', async (req, res) => {
  const { limit, cursor } = pageQuery.parse(req.query);

  const rows = await Note.find({ owner: currentUser(req).id, ...olderThan(cursor) })
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();

  res.json(toPage(rows, limit));
});

notesRouter.post('/', async (req, res) => {
  const data = createBody.parse(req.body);
  const note = await Note.create({ ...data, owner: currentUser(req).id });
  res.status(201).json({ note });
});

// Read one note. Index: _id. Admins may read any note; users only their own.
notesRouter.get('/:id', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const user = currentUser(req);

  // The owner check is part of the query, so someone else's note looks
  // exactly like a note that does not exist (no id probing).
  const filter = user.role === 'admin' ? { _id: id } : { _id: id, owner: user.id };
  const note = await Note.findOne(filter).lean();
  if (!note) throw notFound('Note');

  res.json({ note });
});

// Update and delete are owner-only, for admins too: the spec lets admins
// *view* everyone's notes, not change them.
notesRouter.patch('/:id', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const data = updateBody.parse(req.body);

  const note = await Note.findOneAndUpdate(
    { _id: id, owner: currentUser(req).id },
    { $set: data },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!note) throw notFound('Note');

  res.json({ note });
});

notesRouter.delete('/:id', async (req, res) => {
  const { id } = idParams.parse(req.params);

  const result = await Note.deleteOne({ _id: id, owner: currentUser(req).id });
  if (result.deletedCount === 0) throw notFound('Note');

  res.status(204).end();
});
