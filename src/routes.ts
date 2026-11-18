import { Router } from 'express';
import { apiLimiter } from './middleware/rateLimit.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';

export const apiRouter = Router();

apiRouter.use(apiLimiter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
