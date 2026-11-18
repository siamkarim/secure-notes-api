import type { Request, RequestHandler } from 'express';
import { Types } from 'mongoose';
import { verifyToken } from '../lib/jwt.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { User, type Role } from '../models/user.model.js';

export interface AuthUser {
  id: Types.ObjectId;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();

  const payload = verifyToken('access', header.slice('Bearer '.length));
  if (!Types.ObjectId.isValid(payload.sub)) throw unauthorized();

  // Load the user on every request (by _id, so it is an index lookup).
  // The role comes from the database, never from the token, and a deleted
  // user or a bumped tokenVersion invalidates the token immediately.
  const user = await User.findById(payload.sub).select('role tokenVersion').lean();
  if (!user || user.tokenVersion !== payload.tv) throw unauthorized('Invalid or expired token');

  req.user = { id: user._id, role: user.role };
  next();
};

export const requireRole =
  (role: Role): RequestHandler =>
  (req, _res, next) => {
    if (req.user?.role !== role) throw forbidden();
    next();
  };

/** Use inside handlers that sit behind requireAuth. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
