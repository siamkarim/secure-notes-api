import { Schema, model, type InferSchemaType } from 'mongoose';

export const ROLES = ['user', 'admin'] as const;
export type Role = (typeof ROLES)[number];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    // Never returned by default; login opts in with .select('+passwordHash').
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'user' },
    interests: { type: [String], default: [] },
    // Bumped on logout / password change / role change to revoke issued tokens.
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
);

// Login looks users up by email, and emails must be unique.
userSchema.index({ email: 1 }, { unique: true });

// Multikey index: supports the $match stage of the "users grouped by interest" aggregation.
userSchema.index({ interests: 1 });

// Listing users (admin) and fetching a profile both use the default _id index:
// the list is sorted and paged by _id, so no extra index is needed.

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);

/** Fields that are safe to send to clients. */
export const USER_PUBLIC_FIELDS = 'name email role interests createdAt updatedAt';
