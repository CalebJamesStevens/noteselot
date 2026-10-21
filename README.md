# Noteselot

A self-hosted place for personal notes and shared thinking. Local accounts, collaborative writing, whiteboards, and diagrams, with PostgreSQL as the source of truth.

## Included

- Email/password registration and sign-in, with no identity provider or email service.
- Private personal notes and invite-by-email team spaces. Team owners manage membership; members can edit the team's notes.
- Live rich-text editing with collaborator cursors, headings, lists, checklists, tables, quotes, code blocks, links, highlighting, and small embedded images.
- Meeting, brainstorming, and project templates.
- Shared whiteboards with sticky notes, text, shapes, arrows, freehand drawing, resizing, undo/redo, zoom, and SVG export.
- Collaborative Mermaid source editing with flowchart, sequence, and mind-map examples and SVG export.
- Title/body search, favorites, grid/list views, comments, soft-delete/restore, and recoverable snapshots.
- Dark mode by default, light mode, responsive layouts, keyboard shortcuts, and larger touch targets.
- One application container and one PostgreSQL container. No runtime CDN, telemetry, remote font, cloud collaboration, or external authentication dependency.

## Deploy on Coolify

Use a **Git-backed Docker Compose application** so Coolify has the source files needed for `build: .`. Pasting only this Compose file into a raw Service does not supply the application source.

1. Put this project at the root of a Git repository and connect that repository in Coolify.
2. Create an application with the **Docker Compose** build pack. Set the Compose path to `/docker-compose.yml`.
3. Set these environment variables in Coolify:

   ```dotenv
   APP_URL=http://noteselot.130.130.10.18.sslip.io
   POSTGRES_PASSWORD=<a random 64-character hex value>
   ALLOW_REGISTRATION=true
   TRUST_PROXY=1
   ```

   Generate the database password with `openssl rand -hex 32`. Hex avoids connection-string escaping problems.

4. Assign `http://noteselot.130.130.10.18.sslip.io` to the **noteselot** service, targeting container port **3000**. If your Coolify domain field selects the port in the URL, enter `http://noteselot.130.130.10.18.sslip.io:3000`; the browser-facing URL still uses the proxy's HTTP port. Leave `APP_URL` without `:3000`.
5. Deploy. The database health check runs first, then the application creates its tables. No manual migration command is needed for a fresh installation.
6. Visit the domain and choose **Create an account**. Each person creates their own account at that same address. Create a team space, open **Members**, and add registered users by email.

Only the application gets a domain. PostgreSQL has no public port mapping. Coolify's proxy must forward WebSocket upgrades for `/collaboration` on the same origin.

`APP_URL` must exactly match the browser origin, including scheme and any public port. It controls request-origin checks and secure cookies. HTTP works for the requested intranet setup but sends credentials and notes without transport encryption. Use HTTPS in Coolify and change `APP_URL` to `https://...` before exposing the service over an untrusted network.

The `sslip.io` name resolves the encoded IP; clients still need a network route to `130.130.10.18`. For a fully disconnected network, provide an equivalent local DNS entry. Building needs npm and container-registry access; running the built application does not.

## Run with Docker on your own machine

```bash
cp .env.example .env
# Replace POSTGRES_PASSWORD in .env with a generated hex password.
docker compose -f docker-compose.yml -f compose.local.yml up -d --build
```

Open `http://localhost:3000`. The local override binds only to loopback and adjusts `APP_URL` and proxy trust. For Coolify, use the base Compose file alone.

## Development

Use Node.js 24 LTS. The production Dockerfile pins Node.js 24.22.1. Dependencies are exact versions with a committed lockfile.

```bash
npm ci
npm run dev
```

Open `http://localhost:5173`. Development starts the API and Vite together. If `DATABASE_URL` is absent, a development-only PGlite database runs locally and stores its files in `.dev-db/`. Production always uses PostgreSQL through `pg`; the embedded database is not included in the production dependency installation.

To develop against a real PostgreSQL instance, set `DATABASE_URL`. If the browser uses another origin, also set `APP_URL`. The development API uses port 3000 and Vite proxies `/api` and `/collaboration` to it.

```bash
npm run check
npm run build
npm test
npm run audit:security
```

By default, integration tests create a disposable PostgreSQL-compatible PGlite instance. To run against real PostgreSQL, supply `TEST_DATABASE_URL` pointing to a dedicated disposable database. Tests create accounts and documents in that database. The included GitHub Actions workflow runs them with PostgreSQL 18, builds the application and container, and checks advisories. This workflow must run in your repository before treating the container deployment as validated.

## Working with Noteselot

- **Personal notes** are visible only to their owner. Team notes are visible to current team members.
- Create a team, then use **Members** to add someone who has already registered. No email invitation is sent.
- Write using the toolbar or familiar Markdown shortcuts such as `## ` for a heading and `- ` for a list.
- `Ctrl/Cmd + K` opens search. `Ctrl/Cmd + Alt + N` opens the creation dialog.
- Whiteboards use a 1600 × 1000 canvas. Select a tool and click to add an item. Drag with the selection tool. Edit selected text and dimensions in the property panel. Freehand drawing supports pointer input, including a stylus.
- Diagrams use Mermaid source rather than a drag-and-drop graph editor.
- Images are embedded in the document and stored in PostgreSQL. PNG, JPEG, and WebP images up to 300 KB each are supported.
- Text notes export as plain text. Whiteboards and diagrams export as SVG.
- Comments refresh every five seconds. Document edits use live WebSockets.
- Revisions are snapshots taken on the first saved edit and then at most once every five minutes, keeping up to 100 per document. Recovery creates a new note, preserving the current collaborative document.
- Deleted notes remain in Trash until restored; this version has no permanent-delete UI.

## Backups and upgrades

All application records, document state, embedded images, accounts, sessions, comments, and revisions are in PostgreSQL. Back up the database to storage outside the host.

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U noteselot -d noteselot -Fc > backups/noteselot.dump
```

For recovery, stop the application and restore into a fresh, empty `noteselot` database with the same role:

```bash
docker compose stop noteselot
docker compose exec -T postgres pg_restore -U noteselot -d noteselot --no-owner < backups/noteselot.dump
docker compose up -d noteselot
```

Do not restore over a populated database without planning the overwrite. Test restoration periodically. Database volumes are durable across container rebuilds; do not run `docker compose down -v` on the deployment unless intentionally removing its data.

Before an upgrade, take a backup, review dependency changes, run checks and integration tests, and rebuild. Keep the PostgreSQL major version at 18 until a deliberate database upgrade. Do not scale the application to multiple replicas: live rooms are in one process. Horizontal scaling requires an additional shared collaboration layer.

## Password recovery

Users who know their password can change it in account settings. There is no outbound email dependency or email reset flow. An operator with container access can reset an account:

```bash
read -rsp 'New password: ' NOTES_PASSWORD
printf '\n'
printf '%s' "$NOTES_PASSWORD" | docker compose exec -T noteselot node server/reset-password.js person@example.com
unset NOTES_PASSWORD
```

Use 12–128 characters. Existing sessions are invalidated. Restart the application after an operator reset to close any already-open idle sockets immediately:

```bash
docker compose restart noteselot
```

## Code layout

| Path                                | Responsibility                                             |
| ----------------------------------- | ---------------------------------------------------------- |
| `src/App.tsx`                       | Account state, navigation, team/account dialogs            |
| `src/components/Overview.tsx`       | Note list and creation templates                           |
| `src/components/Workspace.tsx`      | Open-document lifecycle, presence, comments, history       |
| `src/components/Editor.tsx`         | Rich-text editing and formatting                           |
| `src/components/Board.tsx`          | Whiteboard rendering and pointer interactions              |
| `src/components/Diagram.tsx`        | Mermaid source and preview                                 |
| `src/styles.css`                    | Theme tokens, layouts, responsive rules                    |
| `server/index.js`                   | HTTP endpoints, validation, WebSocket adapter, startup     |
| `server/auth.js`                    | Password hashing and cookie sessions                       |
| `server/collaboration.js`           | Room authorization, persistence, snapshots                 |
| `server/db.js`, `server/schema.sql` | PostgreSQL access and initial schema                       |
| `server/templates.js`               | Server-created template state                              |
| `tests/integration.test.js`         | Account, permissions, collaboration, and persistence tests |

Use ordinary SQL and explicit route handlers for changes. The initial schema uses idempotent creation; future structural changes should be added as numbered, transactional migrations rather than assuming `CREATE TABLE IF NOT EXISTS` alters existing tables.

## Operational boundaries

This version targets small teams and a single server. It has no public-share links, email verification, read-only team role, attachments other than small images, nested wiki pages, or spreadsheet databases. Account creation is open when `ALLOW_REGISTRATION=true`; knowing an email address is not proof of ownership. Team owners should verify the intended person's account before adding them.

Live edits merge through Yjs. In-memory changes normally persist within 0.35–1.5 seconds; wait for **All changes saved** before closing. During a network interruption, keep the tab open so its in-memory edits can synchronize after reconnecting. There is no offline browser database, so closing an offline tab can lose unsent work. Concurrent changes to the same whiteboard shape resolve at the shape-object level; text notes use character-level collaborative editing.

## Security and validation

Passwords use salted scrypt. Opaque sessions are hashed in PostgreSQL and sent through HttpOnly, SameSite cookies. Requests check their origin, SQL uses parameters, document subscription checks membership, member removal closes existing sockets, and the API applies rate limits. Mermaid uses strict rendering. Production runs as a non-root user with a read-only application filesystem.

The dependency audit on October 21, 2026 reported zero known npm advisories. This is a point-in-time result, not a guarantee that vulnerabilities do not exist. Review automated update PRs and rerun audits regularly. The local environment did not have Docker, so image builds and a real Coolify deployment still require the supplied CI or deployment checks. Browser inspection covered the sign-in screen; authenticated screens and tablet interactions have not received a full manual browser pass.

Official references: [Node.js LTS](https://nodejs.org/en/download/archive/v24.22.1), [Coolify application methods](https://coolify.io/docs/applications/), [Coolify domains](https://coolify.io/docs/core/networking/domains), and [PostgreSQL support policy](https://www.postgresql.org/support/versioning/).
