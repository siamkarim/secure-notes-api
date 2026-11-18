import { Schema, model, type InferSchemaType } from 'mongoose';

const noteSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 10_000 },
  },
  { timestamps: true },
);

// "List my notes, newest first": equality on owner, then sort/range on _id.
// Also serves the admin "notes of one user" filter and the cascade delete of a user's notes.
noteSchema.index({ owner: 1, _id: -1 });

// Fetching one note and the admin "all notes" list use the default _id index.

export type NoteDoc = InferSchemaType<typeof noteSchema>;
export const Note = model('Note', noteSchema);
