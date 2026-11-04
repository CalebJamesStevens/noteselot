# Noteselot

A self-hosted place for personal notes and shared thinking. Local accounts, collaborative writing, whiteboards, and diagrams, with PostgreSQL as the source of truth.

## Included

- Email/password registration and sign-in, with no identity provider or email service.
- Private personal notes and invite-by-email team spaces. Team owners manage membership; members can edit the team's notes.
- Live rich-text editing with collaborator cursors, headings, lists, checklists, tables, quotes, code blocks, links, highlighting, and small embedded images.
- Meeting, brainstorming, and project templates.
- Shared whiteboards with sticky notes, text, shapes, arrows, freehand drawing, resizing, undo/redo, zoom, and SVG export.
- Collaborative Mermaid source editing with flowchart, sequence, and mind-map examples and SVG export.
- Collaborative database schema planning with visual tables, columns, primary keys, crow's-foot relationships, selectable PostgreSQL or IBM i Db2 SQL export, and JSON export.
- Native free-positioned text boxes, API endpoint cards (HTTP method, route and description), Boundary–Control–Entity (BCE) robustness symbols, and labeled architecture connectors. These stay separate from SQL foreign-key relationships.
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
- Database designs are separate visual documents. Drag a table header to position it, click a table to edit columns, click **Relationship** to add a connection, and select the connection (or choose it in the inspector) to configure its source and target columns and cardinalities. The design synchronizes through existing team spaces and persists in PostgreSQL.
- **Endless ERD canvas:** There is no fixed document boundary. **Drag empty space** (or middle-mouse / Space + drag) to pan in any direction, including negative coordinates; a plain mouse wheel or trackpad scroll pans, while **Ctrl/Cmd + wheel or trackpad pinch** zooms around the pointer. Use **− / +** for 1%–250% zoom, **Fit** to center the actual tables and annotations wherever they are, or **100%** to reset scale. New tables, text/API/BCE shapes, and pictures appear near your current viewport instead of the old 1600×1050 origin. Dragging, resizing, and image drops use world coordinates at every zoom level. Pan and zoom are local to each browser; shared diagram contents and JSON exports do not include personal viewport settings.
- **Compact ERD workspace:** The database planner uses a single slim creation toolbar (Table, Relationship, Text, Picture, Connect), a **More** menu for API/Boundary/Control/Entity symbols, and an **Export** menu for Noteselot JSON and SQL. The zoom/fit controls float at the bottom of the canvas. Each button has a descriptive tooltip and accessible label.
- **Make room to work:** Use the **properties panel icon** to show/hide the right-side inspector; selecting an element opens it automatically. At laptop widths the inspector overlays rather than permanently shrinking the canvas, and on larger screens it still has the draggable width divider. When editing a database design, the small collapse button in Noteselot's left navigation minimizes the sidebar.
- **Full-screen diagram:** Click the diagonal-arrows icon in the diagram toolbar to enter focus mode. When supported, this also enables the browser's actual Fullscreen API; otherwise it fills the browser viewport. Both modes hide the regular Noteselot chrome and use all available space. Click the same icon or press **Esc** to leave. These UI states are personal and do not alter the collaborative diagram or its exported JSON.
- **Narrow screens:** Buttons shrink to icons with accessible labels, the toolbar scrolls horizontally if necessary, and the SQL target remains accessible in the Export menu even when its top-bar selector is hidden.
- **Planning notes and APIs:** Use the database designer's **Text box**, **API endpoint**, **Boundary**, **Control**, or **Entity** tools. Click a card to edit its title, description, HTTP method or route in the inspector. Drag the card's header to move it and its lower-right corner to resize. Use **Connect** to link cards or tables with labeled, dashed architecture connectors. BCE notation follows the traditional boundary T-bar, control arrow, and entity baseline shapes.
- **Editor polish:** The browser tab title tracks the open Noteselot document title. Every diagram card uses its own title and matching type icon in its header. Database tables now resize from the bottom-right corner (or via width/height in the inspector); their relationship lines follow the chosen field even when resized.
- **Resizing the inspector:** Drag the vertical divider on the left of the inspector to make the properties panel wider. Keyboard users can focus the divider and use Left/Right arrow keys. On mobile it fills the available width.
- **Formatted Text Boxes:** Select a Text Box and use the larger editor on the right for inline bold, italic, underline, strikethrough, bullet/numbered lists, font size (10–36px) and per-character font color. Content is stored as a Yjs/Tiptap rich-text fragment and synchronized between team members. The plain-text mirror remains indexed for search; Noteselot's own `.erd.json` exports also preserve formatting in an optional `richDoc` field. Old unformatted diagrams continue to load.
- **Field-specific edges:** Database foreign-key Relationships already store source and destination field IDs, and the inspector now labels them explicitly. Architecture **Connect** edges also offer an optional source/destination field selector when either endpoint is a database table. Select **Whole table** when you want a general association. A deleted table column detaches architecture connectors from that field rather than leaving invalid links.
- **Collaboration:** These cards and connectors persist in the same PostgreSQL-backed Yjs ERD document as tables and database relationships, are indexed in Noteselot search, and appear in JSON exports (`annotations` and `architectureConnections`). They do **not** generate SQL, alter table definitions or create foreign keys.
- **Pictures and screenshots:** In a database design, select **Picture** to choose a PNG, JPEG or WebP file, or drop an image directly onto the canvas. Noteselot automatically resizes/optimizes it into a bounded embedded image. Drag its header to move it; drag the corner to resize; select it to edit its title/caption or replace the picture. Images synchronize with coworkers, survive refreshes, travel with Noteselot JSON exports/imports, and remain in place when a personal diagram moves to a team. SVG, remote image URLs, and animated GIF are not supported. The initial embedded-image implementation accepts files under 8 MB, allows up to 8 pictures per diagram, and caps compressed image data to keep team syncing and JSON backups manageable. For larger image libraries use external file storage, not embedded diagrams.
- **Import compatibility:** Noteselot can export and re-import its own `.erd.json` files (versions 1–3), including the tables, relationships, database target, canvas positions, text/API/BCE annotations, and architecture connectors. Standalone dineug ERD Editor JSON is a different format and is not supported yet. SVG export of the combined ERD canvas is not yet available.
- Select **PostgreSQL** (the default) or **IBM i Db2** in each database design's SQL target dropdown. This setting, plus the optional IBM i library name, is stored in the shared document and is visible to coworkers.
- IBM i Db2 offers SQL data types including CHAR, VARCHAR, GRAPHIC, VARGRAPHIC, packed DECIMAL (DDS P), zoned NUMERIC (DDS S), DECFLOAT, BINARY, VARBINARY, CLOB, and BLOB. Change lengths or precision/scale directly in the type field, and use the **Quick add IBM i field** templates for common field patterns.
- Optionally set an IBM i library/schema qualifier, 10-character system file name (`FOR SYSTEM NAME`) for a table whose SQL name is not a valid system object name, system column names (`FOR COLUMN`), and common CCSID overrides (CHAR/VARCHAR only). Exports use SQL naming (`SCHEMA.TABLE`).
- Switching dialect does **not** silently translate pre-existing column types. For example, PostgreSQL `uuid` and `jsonb` must be replaced with appropriate Db2 types before export. Invalid or mismatched data types block DDL export instead of producing silently corrupted SQL.
- **Share by export/import (copy):** Open a personal database design and click **JSON**. In a team space, click **New → Import database design**, choose the exported `.erd.json`, select the destination team, and import it. Noteselot creates a *new* collaborative design in the team. Your personal original, its ID, comments, and revision history remain unchanged. Import validates diagram references, IDs, structure, and size before creating anything; all team members then have edit access.
- **Share without exporting (move):** Open a personal database design you own. Once its save indicator shows **All changes saved**, click **Move to team** (folder arrow in the top bar), choose one of your teams and confirm. Noteselot moves the original document (same ID, Yjs state, comments, and revision history) from personal to team access. Everyone on that team can then edit it. This is not a duplicate or a reversible private copy. Only the personal owner and a member of the destination team can move it.
- SQL export is a **review-only draft**, not a migration engine or DDS source recovery tool. Foreign key export currently supports only single-column primary key references; composite primary keys can be defined but composite relationships cannot be exported. Live database introspection is not included yet.
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
