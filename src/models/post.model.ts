import { Schema, model, type InferSchemaType } from 'mongoose';

const postSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 10_000 },
  },
  { timestamps: true },
);

// Supports the $lookup from users into posts (join on author), with the
// newest-first sort and cursor range on _id served by the same index.
// Also serves the cascade delete of a user's posts.
postSchema.index({ author: 1, _id: -1 });

export type PostDoc = InferSchemaType<typeof postSchema>;
export const Post = model('Post', postSchema);
