# Secure Notes API

REST API for a note-taking app with JWT authentication and role-based access control.

- **Stack:** Node.js, Express 5, TypeScript, MongoDB with Mongoose, JWT, argon2id
- **Frontend repo:** https://github.com/siamkarim/secure-notes-web
- **Live API:** _add the Render URL here_
- **Live frontend:** _add the Vercel URL here_

## Contents

1. [Run it locally](#run-it-locally)
2. [Roles and permissions](#roles-and-permissions)
3. [Endpoints](#endpoints)
4. [Pagination](#pagination)
5. [Indexes](#indexes)
6. [Aggregations](#aggregations)
7. [Security](#security)
8. [Tests](#tests)
9. [Deployment](#deployment)
10. [Trade-offs](#trade-offs)

## Run it locally

Requires Node.js 20+ and a MongoDB (local, Docker or Atlas).

```bash
npm install
cp .env.example .env        # then fill in the two JWT secrets (see the comment in the file)

# a local MongoDB, if you do not have one
docker run -d --name secure-notes-mongo -p 127.0.0.1:27017:27017 mongo:8

# create the first admin (public registration can never create one)
SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD='choose-a-password' npm run seed:admin

npm run seed:demo           # optional: 30 demo users with interests, notes and posts
npm run dev                 # http://localhost:4000
```

| Command | What it does |
|---|---|
| `npm run dev` | Start with reload |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm test` | Run all tests against an in-memory MongoDB |
| `npm run explain` | Print the index MongoDB uses for every read query |
| `npm run seed:admin` / `npm run seed:demo` | Seed data |

## Roles and permissions

| Action | User | Admin |
|---|---|---|
| Create, list, read, update, delete **own** notes | yes | yes |
| Read anyone's notes | no | yes (read-only) |
| Update or delete someone else's notes | no | no |
| Add, list, update, remove users | no | yes |
| Edit own profile (name, interests, password) | yes | yes |
| See users grouped by interest | yes | yes |
| Write posts | yes | yes |
| Read a user's posts | public | public |

The task says an admin "can view everyone's notes", so admins get read access only; changing another person's note is not allowed.

## Endpoints

All paths start with `/api`. Errors always look like `{ "error": { "code", "message", "details?" } }`.

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/auth/register` | public | Always creates a `user`. Returns `{ user, accessToken }` and sets the refresh cookie |
| POST | `/auth/login` | public | Same response as register |
| POST | `/auth/refresh` | refresh cookie | New access token, rotated refresh cookie |
| POST | `/auth/logout` | refresh cookie | Revokes all of the user's tokens |
| GET | `/users/me` | user | Own profile |
| PATCH | `/users/me` | user | `name`, `interests`, or `currentPassword` + `newPassword` |
| GET | `/users/by-interest` | user | **Aggregation 1.** `?limit&cursor&interest` |
| GET | `/users/:id/posts` | public | **Aggregation 2** (`$lookup`). `?limit&cursor` |
| POST | `/posts` | user | Create a post |
| GET | `/notes` | user | Own notes. `?limit&cursor` |
| POST | `/notes` | user | |
| GET | `/notes/:id` | owner or admin | |
| PATCH | `/notes/:id` | owner | |
| DELETE | `/notes/:id` | owner | |
| GET | `/admin/users` | admin | `?limit&cursor` |
| POST | `/admin/users` | admin | Can set `role` |
| GET | `/admin/users/:id` | admin | |
| PATCH | `/admin/users/:id` | admin | `name`, `email`, `role`, `interests`, `password` |
| DELETE | `/admin/users/:id` | admin | Also deletes that user's notes and posts |
| GET | `/admin/notes` | admin | Everyone's notes. `?limit&cursor&owner` |
| GET | `/healthz` | public | Outside `/api` |

Send the access token as `Authorization: Bearer <token>`.

## Pagination

Every list endpoint uses **cursor (keyset) pagination**:

```
GET /api/notes?limit=20
-> { "items": [...], "nextCursor": "665f1c..." }

GET /api/notes?limit=20&cursor=665f1c...
-> { "items": [...], "nextCursor": null }      // null = last page
```

`limit` is 1 to 100 (default 20). Lists are ordered newest first by `_id`.

Why a cursor and not `page`/`skip`:

- `skip(n)` makes MongoDB walk past `n` index entries, so page 500 is much slower than page 1. A cursor query (`_id < cursor`) jumps straight to the right place in the index; every page costs the same.
- An ObjectId starts with its creation timestamp, so sorting by `_id` **is** "newest first". That means lists do not need an extra `createdAt` index.
- New rows inserted while someone is paging do not shift or duplicate items.

## Indexes

All indexes are declared with `schema.index()` in [`src/models`](src/models). There are **four**, plus MongoDB's built-in `_id` index on each collection.

| Collection | Index | Why it exists |
|---|---|---|
| `users` | `{ email: 1 }` unique | Login finds the user by email. Also guarantees one account per email. |
| `users` | `{ interests: 1 }` (multikey) | First `$match` of the "users grouped by interest" aggregation. |
| `notes` | `{ owner: 1, _id: -1 }` | "My notes, newest first": equality on `owner`, then sort and cursor range on `_id`. Also used by the admin `?owner=` filter and when a deleted user's notes are removed. |
| `posts` | `{ author: 1, _id: -1 }` | The `$lookup` join on `author`, with the newest-first sort and cursor served by the same index. Also used when a deleted user's posts are removed. |

Queries that need **no** extra index, because the default `_id` index already serves them:

| Query | Reason |
|---|---|
| Fetch a profile, fetch one note, auth check on each request | Lookup by `_id` |
| Admin: list all users | Sorted and paged by `_id` |
| Admin: list all notes | Sorted and paged by `_id` |

Indexes deliberately **not** created:

- `{ createdAt: -1 }` on any collection: `_id` already gives creation order.
- `{ role: 1 }`: nothing filters by role, and a two-value field is a poor index anyway.
- A separate `{ owner: 1 }` or `{ author: 1 }`: they are prefixes of the compound indexes above.
- A sessions/refresh-token collection: token revocation uses a counter on the user document instead (see [Security](#security)), so no extra collection or index is needed.

### Proof

`npm run explain` runs `explain('executionStats')` for every read query. Output against the demo data (31 users, 180 notes, 120 posts):

| Endpoint | Index used | Keys examined | Docs examined | Collection scan |
|---|---|---|---|---|
| `POST /auth/login` (find by email) | `email_1` | 1 | 1 | no |
| `GET /users/me`, `GET /admin/users/:id`, auth check | `_id_` | 1 | 1 | no |
| `GET /admin/users` (page 1 / next page) | `_id_` | 21 | 21 | no |
| `GET /notes` (page 1 / next page) | `owner_1__id_-1` | 6 | 6 | no |
| `GET /notes/:id` | `_id_` | 1 | 1 | no |
| `GET /admin/notes` (page 1 / next page) | `_id_` | 21 | 21 | no |
| `GET /users/by-interest` (page 1) | `interests_1` | 64 | 24 | no |
| `GET /users/by-interest?interest=chess` | `interests_1` | 7 | 7 | no |
| `GET /users/:id/posts` | `_id_` + `author_1__id_-1` | 1 | 1 | no |

"21" is `limit + 1`: one extra row is read only to know whether a next page exists. The `/notes` rows show 6 because that demo user has 6 notes.

The same checks run as tests ([`tests/indexes.test.ts`](tests/indexes.test.ts)): each collection must have exactly the indexes listed above, every query must use its expected index with no `COLLSCAN`, and every declared index must be used by at least one query.

## Aggregations

Both pipelines live in [`src/modules/users/users.aggregations.ts`](src/modules/users/users.aggregations.ts).

### 1. Users grouped by interest

`GET /api/users/by-interest` runs exactly one `User.aggregate()` call and nothing else.

```js
[
  { $match:  { interests: { $gt: cursor ?? '' } } },   // IXSCAN on { interests: 1 }
  { $unwind: '$interests' },
  { $match:  { interests: { $gt: cursor ?? '' } } },
  { $group:  { _id: '$interests',
               count: { $sum: 1 },
               users: { $firstN: { n: 50, input: { _id: '$_id', name: '$name' } } } } },
  { $sort:   { _id: 1 } },
  { $limit:  limit + 1 }
]
```

- **First `$match`** is what the index is for. Users with an empty `interests` array are never read, and on later pages neither are users whose interests all come before the cursor. With `?interest=chess` it becomes an equality match that reads only chess users.
- **`$unwind`** turns one user with three interests into three rows.
- **Second `$match`** is needed because a user who passed the first match can still carry interests outside the requested range.
- **`$group`** builds one document per interest. `$firstN` caps the embedded user list at 50 so a very popular interest cannot exceed the 16 MB document limit; `count` still holds the real total.
- **`$sort` + `$limit`** return one page of groups, ordered A to Z. The cursor is the last interest name.

Only `_id` and `name` are returned, never emails. Interests are trimmed, lower-cased and de-duplicated when saved, so `Chess` and `chess` land in the same group.

### 2. Posts of a user (`$lookup`)

`GET /api/users/:id/posts` runs one aggregation on the `users` collection.

```js
[
  { $match: { _id: userId } },                          // _id index
  { $lookup: {
      from: 'posts',
      localField: '_id',
      foreignField: 'author',                           // index { author: 1, _id: -1 }
      pipeline: [
        { $match: { _id: { $lt: cursor } } },           // only when a cursor is given
        { $sort:  { _id: -1 } },
        { $limit: limit + 1 },
        { $project: { title: 1, body: 1, createdAt: 1 } }
      ],
      as: 'posts'
  } },
  { $project: { name: 1, posts: 1 } }
]
```

- Starting from `users` means one query answers both "does this user exist?" (no result gives 404) and "what are their posts?".
- The join condition (`author` equality) and the sort and range on `_id` match the index `{ author: 1, _id: -1 }` field for field, so the posts come out of the index already in order.
- Posts are public, so this endpoint needs no login.

## Security

### Passwords

- Hashed with **argon2id** (19 MiB memory, 2 iterations), the OWASP first choice. The hash is never selected by default (`select: false`) and never returned.
- Length 8 to 128. The upper bound stops huge inputs being used to burn CPU.
- Login always runs one hash verification, even for an unknown email, and always answers "Invalid email or password". Response and timing do not reveal whether an account exists.

### Tokens

| | Access token | Refresh token |
|---|---|---|
| Lifetime | 15 minutes | 7 days |
| Sent as | `Authorization: Bearer` header | `httpOnly`, `Secure`, `SameSite=Strict` cookie, path `/api/auth` |
| Stored in the browser | memory only | cookie that JavaScript cannot read |
| Secret | `JWT_ACCESS_SECRET` | `JWT_REFRESH_SECRET` (must differ) |

- Verification pins the algorithm to HS256 and checks issuer and audience, so `alg: none` tokens and refresh tokens used as access tokens are rejected.
- The server refuses to start if a secret is missing, shorter than 32 characters, or if both secrets are equal.
- **Revocation:** each user has a `tokenVersion` number that is copied into their tokens. Logout, a password change, or an admin changing the role or password increments it, which invalidates every token issued before.
- **Every request re-reads the user by `_id`.** The role comes from the database, not from the token, so a demotion or deletion takes effect on the very next request.

### Access control

- `requireAuth` and `requireRole('admin')` guard the routes.
- Ownership is part of the database filter (`{ _id, owner: currentUser }`), not a check after loading. Someone else's note answers `404`, exactly like a note that does not exist, so ids cannot be probed.
- Request bodies are validated with strict zod schemas: unknown fields are rejected. A client cannot send `role` on registration or `owner` on a note.
- An admin cannot delete or demote their own account, so the last admin cannot lock everyone out by accident.

### Input and transport

- Every body, query string and id is validated before it reaches the database. Mongoose `sanitizeFilter` additionally neutralises operators such as `{ "$ne": null }` inside query filters.
- `helmet` security headers, CORS restricted to `CORS_ORIGINS`, JSON bodies limited to 100 kB.
- Rate limits: 10 attempts per 15 minutes on login and register (per IP and email), 1000 requests per 15 minutes on the API overall.
- One error handler formats every error. No stack traces or database messages reach the client in production. Logs redact the `Authorization` and `Cookie` headers.
- Secrets live only in environment variables; `.env` is git-ignored.

### CSRF and cross-site cookies

The frontend host proxies `/api/*` to this API, so the browser talks to a single origin. The refresh cookie is therefore first-party and `SameSite=Strict`: another site cannot make the browser send it. All other endpoints need the `Authorization` header, which a cross-site form cannot set.

## Tests

`npm test` runs 43 tests against an in-memory MongoDB (downloaded on first run):

- **auth:** registration rules, no admin via registration, duplicate emails, identical login errors, operator injection, forged and unsigned tokens, refresh, logout revocation, password change.
- **notes:** CRUD, pagination order and cursors, a user cannot touch another user's note, admin read-only access.
- **admin:** every admin route returns 401 without a token and 403 for a normal user; user management; role change revokes tokens; cascade delete.
- **aggregations:** grouping, paging and filtering by interest; posts by user.
- **indexes:** exact index list, expected index per query, no collection scans.

## Deployment

**MongoDB Atlas:** create a free M0 cluster, a database user, and allow access from anywhere (`0.0.0.0/0`, since Render has no fixed IP on the free plan).

**Render** (Web Service, free plan):

| Setting | Value |
|---|---|
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check path | `/healthz` |

Environment variables: `NODE_ENV=production`, `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGINS` (the Vercel URL), `TRUST_PROXY=1`.

Create the admin once from your machine, pointing at Atlas:

```bash
MONGODB_URI='<atlas uri>' SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npm run seed:admin
```

The free Render plan sleeps after 15 idle minutes; the first request afterwards takes about a minute.

## Trade-offs

- **Notes are ordered by creation time, not last edit.** Ordering by `updatedAt` would need a second index on `notes`. The task asks for the minimum set, so I kept `_id` ordering.
- **Logout signs the user out on all devices.** Per-device sessions need a stored session per login (a new collection plus an index), and would also allow detecting a stolen refresh token being reused. The version counter gives revocation with no extra index.
- **No total counts in list responses.** Counting all matching documents on every page request is extra work the client does not need for "load more".
- **Rate limits are kept in memory.** Correct for one server instance; several instances would need a shared store such as Redis.
- **Cascade delete is not a transaction.** The user is removed first (their tokens stop working at once), then their notes and posts. If the process died in between, orphaned notes would remain but would be unreachable.
