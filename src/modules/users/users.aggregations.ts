import type { PipelineStage, Types } from 'mongoose';

/** How many users are embedded per interest group (the full size is in `count`). */
export const USERS_PER_GROUP = 50;

/**
 * Scenario 1: users grouped by interest.
 *
 * Paged by interest name (A -> Z). `after` is the last interest of the previous page.
 * If `only` is given, just that one interest group is returned.
 *
 *  1. $match  uses the multikey index { interests: 1 }. Users with no interests are
 *             never read, and on later pages neither are users who only have
 *             interests from earlier pages.
 *  2. $unwind one document per (user, interest) pair.
 *  3. $match  a user who passed step 1 can still carry interests outside the
 *             requested range; drop those pairs.
 *  4. $group  one document per interest. $firstN caps the embedded list so a very
 *             popular interest cannot hit the 16 MB document limit.
 *  5. $sort + $limit: one page of groups (limit + 1 to detect a next page).
 */
export function usersByInterestPipeline(opts: {
  limit: number;
  after?: string;
  only?: string;
}): PipelineStage[] {
  const condition = opts.only !== undefined ? opts.only : { $gt: opts.after ?? '' };

  return [
    { $match: { interests: condition } },
    { $unwind: '$interests' },
    { $match: { interests: condition } },
    {
      $group: {
        _id: '$interests',
        count: { $sum: 1 },
        users: { $firstN: { n: USERS_PER_GROUP, input: { _id: '$_id', name: '$name' } } },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: opts.limit + 1 },
  ];
}

/**
 * Scenario 2: all posts of one user, via $lookup (run on the users collection).
 *
 *  1. $match   the user by _id (default index). No match -> empty result -> 404.
 *  2. $lookup  joins posts on posts.author = users._id. The sub-pipeline pages the
 *              joined posts newest-first. Equality on author plus sort/range on _id
 *              is served entirely by the index { author: 1, _id: -1 }.
 *  3. $project only public fields of the user.
 */
export function userPostsPipeline(opts: {
  userId: Types.ObjectId;
  limit: number;
  cursor?: Types.ObjectId;
}): PipelineStage[] {
  return [
    { $match: { _id: opts.userId } },
    {
      $lookup: {
        from: 'posts',
        localField: '_id',
        foreignField: 'author',
        pipeline: [
          ...(opts.cursor ? [{ $match: { _id: { $lt: opts.cursor } } }] : []),
          { $sort: { _id: -1 } },
          { $limit: opts.limit + 1 },
          { $project: { title: 1, body: 1, createdAt: 1 } },
        ],
        as: 'posts',
      },
    },
    { $project: { name: 1, posts: 1 } },
  ];
}
