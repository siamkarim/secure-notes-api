import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized } from './errors.js';

const ISSUER = 'secure-notes-api';
const ALGORITHM = 'HS256' as const;

type TokenKind = 'access' | 'refresh';

const config = {
  access: {
    secret: env.JWT_ACCESS_SECRET,
    audience: 'secure-notes:access',
    expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
  },
  refresh: {
    secret: env.JWT_REFRESH_SECRET,
    audience: 'secure-notes:refresh',
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d` as SignOptions['expiresIn'],
  },
} satisfies Record<TokenKind, unknown>;

export interface TokenPayload {
  /** User id */
  sub: string;
  /** tokenVersion of the user when the token was issued */
  tv: number;
}

export function signToken(kind: TokenKind, payload: TokenPayload): string {
  const { secret, audience, expiresIn } = config[kind];
  return jwt.sign({ tv: payload.tv }, secret, {
    algorithm: ALGORITHM,
    subject: payload.sub,
    issuer: ISSUER,
    audience,
    expiresIn,
  });
}

export function verifyToken(kind: TokenKind, token: string): TokenPayload {
  const { secret, audience } = config[kind];
  try {
    // Pin the algorithm so "alg: none" or algorithm-confusion tokens are rejected.
    const decoded = jwt.verify(token, secret, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience,
    });
    if (typeof decoded === 'string' || typeof decoded.sub !== 'string' || typeof decoded.tv !== 'number') {
      throw new Error('Malformed token payload');
    }
    return { sub: decoded.sub, tv: decoded.tv };
  } catch {
    throw unauthorized('Invalid or expired token');
  }
}
