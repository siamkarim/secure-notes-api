import { Router, type CookieOptions, type Response } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { env, isProd } from '../../config/env.js';
import { signToken, verifyToken } from '../../lib/jwt.js';
import { getDummyHash, hashPassword, verifyPassword } from '../../lib/password.js';
import { unauthorized } from '../../lib/errors.js';
import { email, interests, name, password } from '../../lib/validation.js';
import { credentialLimiter } from '../../middleware/rateLimit.js';
import { User, USER_PUBLIC_FIELDS } from '../../models/user.model.js';

export const REFRESH_COOKIE = 'refresh_token';

// httpOnly: JavaScript cannot read it (XSS cannot steal it).
// sameSite strict + path: only sent to our own /api/auth endpoints (CSRF protection).
const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'strict',
  path: '/api/auth',
};

/** Issues a new access token (response body) and refresh token (cookie). */
export function issueTokens(res: Response, user: { _id: Types.ObjectId; tokenVersion: number }) {
  const payload = { sub: String(user._id), tv: user.tokenVersion };
  res.cookie(REFRESH_COOKIE, signToken('refresh', payload), {
    ...cookieOptions,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
  return signToken('access', payload);
}

// strictObject rejects unknown keys, so "role" cannot be smuggled in at registration.
const registerBody = z.strictObject({ name, email, password, interests: interests.optional() });
const loginBody = z.strictObject({ email, password: z.string().min(1).max(128) });

export const authRouter = Router();

authRouter.post('/register', credentialLimiter, async (req, res) => {
  const body = registerBody.parse(req.body);

  const created = await User.create({
    name: body.name,
    email: body.email,
    passwordHash: await hashPassword(body.password),
    interests: body.interests ?? [],
    role: 'user', // public registration can never create an admin
  });

  const accessToken = issueTokens(res, created);
  const user = await User.findById(created._id).select(USER_PUBLIC_FIELDS).lean();
  res.status(201).json({ user, accessToken });
});

authRouter.post('/login', credentialLimiter, async (req, res) => {
  const body = loginBody.parse(req.body);

  const user = await User.findOne({ email: body.email })
    .select(`${USER_PUBLIC_FIELDS} tokenVersion +passwordHash`)
    .lean();

  // Always run one hash verification, and always answer with the same message.
  const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), body.password);
  if (!user || !ok) throw unauthorized('Invalid email or password');

  const accessToken = issueTokens(res, user);
  const { passwordHash: _hash, tokenVersion: _tv, ...safeUser } = user;
  res.json({ user: safeUser, accessToken });
});

authRouter.post('/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (typeof token !== 'string') throw unauthorized('No refresh token');

  const payload = verifyToken('refresh', token);
  const user = Types.ObjectId.isValid(payload.sub)
    ? await User.findById(payload.sub).select(`${USER_PUBLIC_FIELDS} tokenVersion`).lean()
    : null;

  if (!user || user.tokenVersion !== payload.tv) {
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    throw unauthorized('Session is no longer valid');
  }

  // Rotation: every refresh hands out a new refresh token.
  const accessToken = issueTokens(res, user);
  const { tokenVersion: _tv, ...safeUser } = user;
  res.json({ user: safeUser, accessToken });
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (typeof token === 'string') {
    try {
      const payload = verifyToken('refresh', token);
      // Bumping tokenVersion revokes every access and refresh token of this user.
      // The version in the filter means a stale token cannot be replayed to log others out.
      if (Types.ObjectId.isValid(payload.sub)) {
        await User.updateOne(
          { _id: payload.sub, tokenVersion: payload.tv },
          { $inc: { tokenVersion: 1 } },
        );
      }
    } catch {
      // An invalid token still results in a cleared cookie.
    }
  }
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
  res.status(204).end();
});
