import { Types } from 'mongoose';
import { Note } from '../models/note.model.js';
import { Post } from '../models/post.model.js';
import { User } from '../models/user.model.js';
import { usersByInterestPipeline, userPostsPipeline } from '../modules/users/users.aggregations.js';
import { olderThan } from './validation.js';

export interface PlanSummary {
  /** Plan stage names found anywhere in the explain output, e.g. IXSCAN, FETCH, COLLSCAN */
  stages: string[];
  /** Names of every index the plan used */
  indexes: string[];
  /** Work done by the main query (not counting the $lookup sub-query) */
  keysExamined: number | null;
  docsExamined: number | null;
}

/** Walks an explain() result and collects the plan stages and index names it mentions. */
export function summarizePlan(explain: unknown): PlanSummary {
  const stages = new Set<string>();
  const indexes = new Set<string>();
  let keysExamined: number | null = null;
  let docsExamined: number | null = null;

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;

    for (const [key, value] of Object.entries(node)) {
      if (key === 'rejectedPlans') continue; // only the winning plan matters
      if (key === 'stage' && typeof value === 'string') stages.add(value);
      if (key === 'indexName' && typeof value === 'string') indexes.add(value);
      // $lookup reports its index use here, and a collection scan as a counter.
      if (key === 'indexesUsed' && Array.isArray(value)) value.forEach((v) => indexes.add(String(v)));
      if (key === 'collectionScans' && Number(value) > 0) stages.add('COLLSCAN');
      if (key === 'totalKeysExamined' && keysExamined === null) keysExamined = Number(value);
      if (key === 'totalDocsExamined' && docsExamined === null) docsExamined = Number(value);
      walk(value);
    }
  };

  walk(explain);
  return { stages: [...stages].sort(), indexes: [...indexes].sort(), keysExamined, docsExamined };
}

export interface CatalogEntry {
  /** The endpoint that runs this query */
  endpoint: string;
  /** Index names the winning plan must use */
  expected: string[];
  explain: () => Promise<unknown>;
}

/**
 * Every read query the API runs, with the index that is expected to serve it.
 * Used by the index tests and by `npm run explain`.
 */
export function queryCatalog(ids: {
  userId: Types.ObjectId;
  noteId: Types.ObjectId;
  cursor: Types.ObjectId;
  email: string;
}): CatalogEntry[] {
  const { userId, noteId, cursor, email } = ids;
  const limit = 20;
  const mode = 'executionStats';

  return [
    {
      endpoint: 'POST /auth/login (find user by email)',
      expected: ['email_1'],
      explain: () => User.findOne({ email }).explain(mode),
    },
    {
      endpoint: 'GET /users/me, GET /admin/users/:id, auth check on every request',
      expected: ['_id_'],
      explain: () => User.findOne({ _id: userId }).explain(mode),
    },
    {
      endpoint: 'GET /admin/users (page 1)',
      expected: ['_id_'],
      explain: () => User.find().sort({ _id: -1 }).limit(limit + 1).explain(mode),
    },
    {
      endpoint: 'GET /admin/users (next page)',
      expected: ['_id_'],
      explain: () => User.find(olderThan(cursor)).sort({ _id: -1 }).limit(limit + 1).explain(mode),
    },
    {
      endpoint: 'GET /notes (page 1)',
      expected: ['owner_1__id_-1'],
      explain: () => Note.find({ owner: userId }).sort({ _id: -1 }).limit(limit + 1).explain(mode),
    },
    {
      endpoint: 'GET /notes (next page), GET /admin/notes?owner=',
      expected: ['owner_1__id_-1'],
      explain: () =>
        Note.find({ owner: userId, ...olderThan(cursor) })
          .sort({ _id: -1 })
          .limit(limit + 1)
          .explain(mode),
    },
    {
      endpoint: 'GET /notes/:id (owner)',
      expected: ['_id_'],
      explain: () => Note.findOne({ _id: noteId, owner: userId }).explain(mode),
    },
    {
      endpoint: 'GET /notes/:id (admin)',
      expected: ['_id_'],
      explain: () => Note.findOne({ _id: noteId }).explain(mode),
    },
    {
      endpoint: 'GET /admin/notes (page 1)',
      expected: ['_id_'],
      explain: () => Note.find().sort({ _id: -1 }).limit(limit + 1).explain(mode),
    },
    {
      endpoint: 'GET /admin/notes (next page)',
      expected: ['_id_'],
      explain: () => Note.find(olderThan(cursor)).sort({ _id: -1 }).limit(limit + 1).explain(mode),
    },
    {
      endpoint: 'GET /users/by-interest (page 1)',
      expected: ['interests_1'],
      explain: () => User.aggregate(usersByInterestPipeline({ limit })).explain(mode),
    },
    {
      endpoint: 'GET /users/by-interest (next page)',
      expected: ['interests_1'],
      explain: () => User.aggregate(usersByInterestPipeline({ limit, after: 'chess' })).explain(mode),
    },
    {
      endpoint: 'GET /users/by-interest?interest=chess',
      expected: ['interests_1'],
      explain: () => User.aggregate(usersByInterestPipeline({ limit, only: 'chess' })).explain(mode),
    },
    {
      endpoint: 'GET /users/:id/posts (page 1)',
      expected: ['_id_', 'author_1__id_-1'],
      explain: () => User.aggregate(userPostsPipeline({ userId, limit })).explain(mode),
    },
    {
      endpoint: 'GET /users/:id/posts (next page)',
      expected: ['_id_', 'author_1__id_-1'],
      explain: () => User.aggregate(userPostsPipeline({ userId, limit, cursor })).explain(mode),
    },
  ];
}
