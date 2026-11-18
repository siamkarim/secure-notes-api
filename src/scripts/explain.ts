/**
 * Prints, for every read query of the API, which index MongoDB actually used.
 * Run `npm run seed:demo` first so there is data to plan against.
 */
import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { connectDb, disconnectDb } from '../db.js';
import { queryCatalog, summarizePlan } from '../lib/explain.js';
import { Note } from '../models/note.model.js';
import { User } from '../models/user.model.js';

await connectDb(env.MONGODB_URI);

const note = await Note.findOne().sort({ _id: -1 }).lean();
const user = note ? await User.findById(note.owner).lean() : null;
if (!note || !user) {
  console.error('No data found. Run `npm run seed:demo` first.');
  await disconnectDb();
  process.exit(1);
}

const catalog = queryCatalog({
  userId: user._id,
  noteId: note._id,
  cursor: new Types.ObjectId(),
  email: user.email,
});

const rows = [];
for (const entry of catalog) {
  const plan = summarizePlan(await entry.explain());
  rows.push({
    endpoint: entry.endpoint,
    'index used': plan.indexes.join(' + '),
    'keys examined': plan.keysExamined,
    'docs examined': plan.docsExamined,
    'collection scan': plan.stages.includes('COLLSCAN') ? 'YES' : 'no',
  });
}
console.table(rows);

await disconnectDb();
