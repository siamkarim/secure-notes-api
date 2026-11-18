import { beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { useTestDb } from './helpers.js';
import { queryCatalog, summarizePlan, type CatalogEntry } from '../src/lib/explain.js';
import { Note } from '../src/models/note.model.js';
import { Post } from '../src/models/post.model.js';
import { User } from '../src/models/user.model.js';

useTestDb();

const INTERESTS = ['art', 'chess', 'music', 'reading', 'zen'];
let catalog: CatalogEntry[];

// Enough data that the planner has a real choice between a scan and an index.
beforeEach(async () => {
  const users = await User.insertMany(
    Array.from({ length: 200 }, (_, i) => ({
      name: `User ${i}`,
      email: `user${i}@example.com`,
      passwordHash: 'x',
      interests: i % 4 === 0 ? [] : [INTERESTS[i % 5]!, INTERESTS[(i + 2) % 5]!],
    })),
  );
  const notes = await Note.insertMany(
    users.flatMap((u) => Array.from({ length: 5 }, (_, i) => ({ owner: u._id, title: `Note ${i}` }))),
  );
  await Post.insertMany(
    users.flatMap((u) =>
      Array.from({ length: 5 }, (_, i) => ({ author: u._id, title: `Post ${i}`, body: 'text' })),
    ),
  );

  const user = users[100]!;
  const userNotes = notes.filter((n) => n.owner.equals(user._id));
  catalog = queryCatalog({
    userId: user._id,
    noteId: userNotes[0]!._id,
    cursor: new Types.ObjectId(), // newer than everything, so every row is "older"
    email: user.email,
  });
});

describe('declared indexes', () => {
  it('each collection has exactly the indexes it needs, and no others', async () => {
    const names = async (model: { collection: { indexes(): Promise<{ name?: string }[]> } }) =>
      (await model.collection.indexes()).map((i) => i.name).sort();

    expect(await names(User)).toEqual(['_id_', 'email_1', 'interests_1']);
    expect(await names(Note)).toEqual(['_id_', 'owner_1__id_-1']);
    expect(await names(Post)).toEqual(['_id_', 'author_1__id_-1']);
  });

  it('every declared index is used by at least one query', async () => {
    const used = new Set<string>();
    for (const entry of catalog) {
      summarizePlan(await entry.explain()).indexes.forEach((name) => used.add(name));
    }
    expect([...used].sort()).toEqual(
      ['_id_', 'author_1__id_-1', 'email_1', 'interests_1', 'owner_1__id_-1'].sort(),
    );
  });
});

describe('every read query is served by an index', () => {
  it('uses the expected index, never a collection scan or an in-memory sort of a scan', async () => {
    for (const entry of catalog) {
      const plan = summarizePlan(await entry.explain());

      expect(plan.stages, `${entry.endpoint}: ${plan.stages}`).not.toContain('COLLSCAN');
      expect(plan.indexes, entry.endpoint).toEqual(entry.expected);
    }
  });

  it('list queries read no more index keys than the page size', async () => {
    const owner = (await User.findOne().lean())!._id;
    const explain: any = await Note.find({ owner })
      .sort({ _id: -1 })
      .limit(3)
      .explain('executionStats');

    expect(explain.executionStats.totalKeysExamined).toBeLessThanOrEqual(3);
    expect(explain.executionStats.totalDocsExamined).toBeLessThanOrEqual(3);
    expect(summarizePlan(explain).stages).not.toContain('SORT');
  });
});
