import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { isTest } from '../config/env.js';

const WINDOW_MS = 15 * 60 * 1000;

const tooMany = {
  error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
};

/** Applied to the whole API. */
export const apiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooMany,
  skip: () => isTest,
});

/**
 * Applied to login and register to slow down password guessing.
 * Keyed by IP + email so one attacker cannot lock everyone out, and so users
 * who share an IP (e.g. behind the frontend proxy) do not share a budget.
 */
export const credentialLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooMany,
  skip: () => isTest,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return `${ipKeyGenerator(req.ip ?? '')}:${email}`;
  },
});
