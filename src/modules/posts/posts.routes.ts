import { Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth } from '../../middleware/auth.js';
import { Post } from '../../models/post.model.js';

const createBody = z.strictObject({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
});

export const postsRouter = Router();

// Posts are public to read (see GET /users/:id/posts) but only logged-in users can write.
postsRouter.post('/', requireAuth, async (req, res) => {
  const data = createBody.parse(req.body);
  const post = await Post.create({ ...data, author: currentUser(req).id });
  res.status(201).json({ post });
});
