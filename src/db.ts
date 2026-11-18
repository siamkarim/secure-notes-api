import mongoose from 'mongoose';
import { User } from './models/user.model.js';
import { Note } from './models/note.model.js';
import { Post } from './models/post.model.js';

// Reject query filters that contain operators coming from user input
// (e.g. { email: { $ne: null } }). Our own operators are wrapped in mongoose.trusted().
mongoose.set('sanitizeFilter', true);
mongoose.set('strictQuery', true);

export async function connectDb(uri: string): Promise<void> {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  // Wait for the indexes declared with schema.index() to be built.
  await Promise.all([User.init(), Note.init(), Post.init()]);
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
