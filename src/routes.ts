import { Router } from 'express';
import { apiLimiter } from './middleware/rateLimit.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { notesRouter } from './modules/notes/notes.routes.js';
import { postsRouter } from './modules/posts/posts.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';

export const apiRouter = Router();

apiRouter.use(apiLimiter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/notes', notesRouter);
apiRouter.use('/posts', postsRouter);
apiRouter.use('/admin', adminRouter);
