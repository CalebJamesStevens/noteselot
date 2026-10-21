CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL,
  password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY, name text NOT NULL, owner_id uuid NOT NULL REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS members (
  team_id uuid REFERENCES teams ON DELETE CASCADE, user_id uuid REFERENCES users ON DELETE CASCADE,
  PRIMARY KEY (team_id,user_id)
);
CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users, team_id uuid REFERENCES teams ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled', kind text NOT NULL DEFAULT 'note' CHECK (kind IN ('note','board','diagram')),
  template text NOT NULL DEFAULT 'blank', state bytea, search_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id uuid REFERENCES users ON DELETE CASCADE, note_id uuid REFERENCES notes ON DELETE CASCADE,
  PRIMARY KEY (user_id,note_id)
);
CREATE TABLE IF NOT EXISTS revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, note_id uuid NOT NULL REFERENCES notes ON DELETE CASCADE,
  state bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY, note_id uuid NOT NULL REFERENCES notes ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_team_idx ON notes(team_id);
CREATE INDEX IF NOT EXISTS notes_owner_idx ON notes(owner_id);
CREATE INDEX IF NOT EXISTS members_user_idx ON members(user_id);
CREATE INDEX IF NOT EXISTS revisions_note_idx ON revisions(note_id,created_at DESC);
CREATE INDEX IF NOT EXISTS comments_note_idx ON comments(note_id,created_at);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
