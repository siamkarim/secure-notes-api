import { z } from 'zod';
import mongoose, { Types } from 'mongoose';

/** A 24-char hex string, converted to an ObjectId. */
export const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid id')
  .transform((v) => new Types.ObjectId(v));

export const idParams = z.object({ id: objectId });

export const limit = z.coerce.number().int().min(1).max(100).default(20);

/** Query string for every list endpoint paged by _id. Unknown parameters are rejected. */
export const pageQuery = z.strictObject({ limit, cursor: objectId.optional() });

export const name = z.string().trim().min(1).max(100);
export const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
// Upper bound stops very long inputs being used to burn CPU in the hash function.
export const password = z.string().min(8, 'Password must be at least 8 characters').max(128);

export const interest = z.string().trim().toLowerCase().min(1).max(40);
export const interests = z
  .array(interest)
  .max(20)
  .transform((list) => [...new Set(list)]);

/**
 * Keyset pagination: "documents older than the cursor".
 * mongoose.trusted() marks the operator as ours, because sanitizeFilter is on.
 */
export function olderThan(cursor: Types.ObjectId | undefined) {
  return cursor ? { _id: mongoose.trusted({ $lt: cursor }) } : {};
}

/** We fetch limit + 1 rows; the extra row only tells us whether another page exists. */
export function toPage<T extends { _id: unknown }>(rows: T[], pageSize: number) {
  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? String(last._id) : null };
}
