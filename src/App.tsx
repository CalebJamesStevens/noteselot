import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  FileText,
  GitBranch,
  Home,
  LockKeyhole,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Star,
  StickyNote,
  Sun,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { api, post } from "./api";
import type { User, Team, Note, Kind } from "./types";
import Overview from "./components/Overview";
import FeatherIcon from "./components/FeatherIcon";
import Auth from "./components/Auth";
import Workspace from "./components/Workspace";
import { Avatar, Logo, Modal } from "./components/ui";
const kinds = { note: FileText, board: StickyNote, diagram: GitBranch };
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [notes, setNotes] = useState<Note[]>([]),
    [teams, setTeams] = useState<Team[]>([]),
    [view, setView] = useState("home"),
    [selected, setSelected] = useState<string | null>(
      new URLSearchParams(location.search).get("note"),
    ),
    [query, setQuery] = useState(""),
    [layout, setLayout] = useState("grid"),
    [sort, setSort] = useState("recent"),
    [modal, setModal] = useState<
      "create" | "team" | "members" | "settings" | null
    >(null),
    [theme, setTheme] = useState(
      localStorage.getItem("noteselot-theme") || "dark",
    ),
    [notice, setNotice] = useState(""),
    [sidebar, setSidebar] = useState(false),
    [members, setMembers] = useState<User[]>([]),
    [busy, setBusy] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const activeTeam = teams.find((t) => t.id === view),
    current = notes.find((n) => n.id === selected && !n.deleted_at);
  async function refresh() {
    const [n, t] = await Promise.all([
      api<Note[]>("/notes"),
      api<Team[]>("/teams"),
    ]);
    setNotes(n);
    setTeams(t);
  }
  useEffect(() => {
    api<User>("/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (user) refresh().catch((e) => setNotice(e.message));
  }, [user]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("noteselot-theme", theme);
  }, [theme]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    const url = new URL(location.href);
    if (selected) url.searchParams.set("note", selected);
    else url.searchParams.delete("note");
    history.replaceState(null, "", url);
  }, [selected]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSelected(null);
        setSidebar(true);
        setTimeout(() => search.current?.focus(), 50);
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setModal("create");
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!user || !query.trim()) return;
    let live = true;
    const timer = setTimeout(
      () =>
        api<Note[]>(`/notes?q=${encodeURIComponent(query)}`)
          .then((v) => {
            if (live) setSearchResults(v);
          })
          .catch((e) => setNotice(e.message)),
      200,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, user]);
  const [searchResults, setSearchResults] = useState<Note[]>([]);
  async function loadMembers() {
    if (!activeTeam) return;
    setMembers(await api<User[]>(`/teams/${activeTeam.id}/members`));
  }
  useEffect(() => {
    if (modal === "members") loadMembers().catch((e) => setNotice(e.message));
  }, [modal, view]);
  function navigate(value: string) {
    setView(value);
    setSelected(null);
    setQuery("");
    setSidebar(false);
  }
  async function create(kind: Kind, template = "blank") {
    if (busy) return;
    setBusy(true);
    try {
      const note = await post<Note>("/notes", {
        kind,
        template,
        team_id: activeTeam?.id || null,
        title:
          template === "meeting"
            ? "Meeting notes"
            : template === "ideas"
              ? "A new idea"
              : template === "project"
                ? "Project brief"
                : kind === "board"
                  ? "Untitled whiteboard"
                  : kind === "diagram"
                    ? "Untitled diagram"
                    : "Untitled",
      });
      await refresh();
      setSelected(note.id);
      setModal(null);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <div className="loading-screen">
        <Logo />
        <p>Opening your thinking space…</p>
      </div>
    );
  if (!user) return <Auth onSignIn={setUser} />;
  let visible = (query.trim() ? searchResults : notes).filter((n) =>
    view === "trash" ? !!n.deleted_at : !n.deleted_at,
  );
  if (!query.trim()) {
    if (view === "personal") visible = visible.filter((n) => !n.team_id);
    if (activeTeam) visible = visible.filter((n) => n.team_id === view);
    if (view === "favorites") visible = visible.filter((n) => n.favorite);
  }
  if (sort === "alpha")
    visible = [...visible].sort((a, b) => a.title.localeCompare(b.title));
  const title = query.trim()
    ? "Search results"
    : view === "home"
      ? "Your thinking space"
      : view === "personal"
        ? "Personal notes"
        : view === "favorites"
          ? "A few favorites"
          : view === "trash"
            ? "Recently set aside"
            : activeTeam?.name || "Your notes";
  const count = notes.filter((n) => !n.deleted_at).length;
  return (
    <div className="app-shell">
      {sidebar && (
        <div className="sidebar-scrim" onClick={() => setSidebar(false)} />
      )}
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate("home");
          }}
        >
          <Logo />
          Noteselot
        </a>
        <button className="workspace-switch" onClick={() => navigate("home")}>
          <span className="workspace-symbol">
            <BookOpen size={18} />
          </span>
          <span>
            My workspace<small>A little room to think</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="sidebar-search">
          <Search size={16} />
          <input
            ref={search}
            aria-label="Search notes"
            placeholder="Search anything"
            value={query}
            onChange={(e) => {
              setSelected(null);
              setQuery(e.target.value);
            }}
          />
          <kbd>⌘ K</kbd>
        </div>
        <nav>
          <button
            className={view === "home" ? "selected" : ""}
            onClick={() => navigate("home")}
          >
            <Home size={18} />
            Overview<span className="nav-count">{count}</span>
          </button>
          <button
            className={view === "favorites" ? "selected" : ""}
            onClick={() => navigate("favorites")}
          >
            <Star size={18} />
            Favorites
          </button>
          <div className="nav-label">YOUR SPACE</div>
          <button
            className={view === "personal" ? "selected" : ""}
            onClick={() => navigate("personal")}
          >
            <LockKeyhole size={17} />
            Personal notes
          </button>
          <div className="nav-label">
            TEAM SPACES
            <button
              aria-label="Create team space"
              title="Create team space"
              onClick={() => setModal("team")}
            >
              <Plus size={15} />
            </button>
          </div>
          {teams.map((t) => (
            <button
              key={t.id}
              className={view === t.id ? "selected" : ""}
              onClick={() => navigate(t.id)}
            >
              <Users size={17} />
              <span className="truncate">{t.name}</span>
              <ChevronRight size={13} />
            </button>
          ))}
          {!teams.length && (
            <button className="subtle" onClick={() => setModal("team")}>
              <CirclePlus size={16} />
              Create a team space
            </button>
          )}
          <div className="sidebar-favorites">
            {notes
              .filter((n) => n.favorite && !n.deleted_at)
              .slice(0, 5)
              .map((n) => {
                const Icon = kinds[n.kind];
                return (
                  <button
                    className={selected === n.id ? "selected" : ""}
                    key={n.id}
                    onClick={() => {
                      setSelected(n.id);
                      setSidebar(false);
                    }}
                  >
                    <Icon size={16} />
                    <span className="truncate">{n.title}</span>
                  </button>
                );
              })}
          </div>
        </nav>
        <div className="sidebar-bottom">
          <div className="quiet-card">
            <span className="little-orbit">
              <FeatherIcon />
            </span>
            <p>
              A place for your
              <br />
              <strong>next good idea.</strong>
            </p>
          </div>
          <button
            className={`trash-nav ${view === "trash" ? "selected" : ""}`}
            onClick={() => navigate("trash")}
          >
            <Trash2 size={17} />
            Trash
          </button>
          <div className="user-menu">
            <Avatar name={user.name} />
            <button className="user-name" onClick={() => setModal("settings")}>
              <strong>{user.name}</strong>
              <small>Account settings</small>
            </button>
            <button
              className="icon-button"
              aria-label="Toggle theme"
              title="Toggle theme"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="mobile-bar">
          <button
            className="icon-button"
            aria-label="Open sidebar"
            onClick={() => setSidebar(true)}
          >
            <Menu size={20} />
          </button>
          <span>Noteselot</span>
          <button
            className="icon-button"
            aria-label="New note"
            onClick={() => setModal("create")}
          >
            <Plus size={20} />
          </button>
        </div>
        {current ? (
          <Workspace
            key={current.id}
            note={current}
            user={user}
            theme={theme}
            onClose={() => {
              setSelected(null);
              void refresh();
            }}
            onRefresh={refresh}
            onError={setNotice}
          />
        ) : (
          <Overview
            activeTeam={activeTeam}
            view={view}
            query={query}
            user={user}
            title={title}
            setModal={setModal}
            create={create}
            visible={visible}
            layout={layout}
            sort={sort}
            setSort={setSort}
            setLayout={setLayout}
            navigate={navigate}
            teams={teams}
            setSelected={setSelected}
            refresh={refresh}
            setNotice={setNotice}
          />
        )}
      </main>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {modal === "create" && (
        <Modal title="Make room for an idea" onClose={() => setModal(null)}>
          <p className="muted">
            Creating in {activeTeam?.name || "your personal space"}.
          </p>
          <div className="create-options">
            {(
              [
                {
                  kind: "note",
                  title: "Note",
                  text: "Rich text, checklists, tables, and more.",
                  Icon: FileText,
                },
                {
                  kind: "board",
                  title: "Whiteboard",
                  text: "Sticky notes, shapes, and freehand thinking.",
                  Icon: StickyNote,
                },
                {
                  kind: "diagram",
                  title: "Diagram",
                  text: "Flowcharts, sequences, and mind maps.",
                  Icon: GitBranch,
                },
              ] as const
            ).map((t) => (
              <button
                disabled={busy}
                key={t.kind}
                onClick={() => create(t.kind)}
              >
                <t.Icon size={24} />
                <span>
                  <strong>{t.title}</strong>
                  <small>{t.text}</small>
                </span>
                <ArrowRight size={18} />
              </button>
            ))}
          </div>
        </Modal>
      )}
      {modal === "team" && (
        <Modal title="A space to think together" onClose={() => setModal(null)}>
          <p className="muted">
            Only people you add can see this team's notes.
          </p>
          <form
            onSubmit={async (e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              const data = Object.fromEntries(new FormData(e.currentTarget));
              try {
                const t = await post<Team>("/teams", data);
                await refresh();
                navigate(t.id);
                setModal(null);
              } catch (e) {
                setNotice((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Team name
              <input
                name="name"
                required
                maxLength={200}
                placeholder="Design studio"
                autoFocus
              />
            </label>
            <button className="primary" disabled={busy}>
              Create team space
              <ArrowRight size={16} />
            </button>
          </form>
        </Modal>
      )}
      {modal === "members" && activeTeam && (
        <Modal
          title={`${activeTeam.name} · Members`}
          onClose={() => setModal(null)}
        >
          <p className="muted">
            Members can create, edit, and recover all notes in this space.
          </p>
          <div className="member-list">
            {members.map((m) => (
              <div key={m.id}>
                <Avatar name={m.name} />
                <span>
                  <strong>{m.name}</strong>
                  <small>{m.email}</small>
                </span>
                {m.id === activeTeam.owner_id ? (
                  <small>Owner</small>
                ) : (
                  activeTeam.owner_id === user.id && (
                    <button
                      className="icon-button"
                      aria-label={`Remove ${m.name}`}
                      onClick={async () => {
                        if (!confirm(`Remove ${m.name} from this team?`))
                          return;
                        try {
                          await api(`/teams/${activeTeam.id}/members/${m.id}`, {
                            method: "DELETE",
                          });
                          await loadMembers();
                        } catch (e) {
                          setNotice((e as Error).message);
                        }
                      }}
                    >
                      <X size={16} />
                    </button>
                  )
                )}
              </div>
            ))}
          </div>
          {activeTeam.owner_id === user.id && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const email = new FormData(form).get("email");
                try {
                  await post(`/teams/${activeTeam.id}/members`, { email });
                  await loadMembers();
                  form.reset();
                } catch (e) {
                  setNotice((e as Error).message);
                }
              }}
            >
              <label>
                Add by email
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="teammate@example.com"
                />
              </label>
              <p className="help-text">
                Ask them to create an account at this same address first.
              </p>
              <button className="primary">
                <Plus size={16} />
                Add member
              </button>
            </form>
          )}
        </Modal>
      )}
      {modal === "settings" && (
        <Modal title="Make it your space" onClose={() => setModal(null)}>
          <div className="settings-section">
            <h3>Appearance</h3>
            <div className="theme-picker">
              <button
                className={theme === "dark" ? "active" : ""}
                onClick={() => setTheme("dark")}
              >
                <Moon size={18} />
                Dark{theme === "dark" && <Check size={15} />}
              </button>
              <button
                className={theme === "light" ? "active" : ""}
                onClick={() => setTheme("light")}
              >
                <Sun size={18} />
                Light{theme === "light" && <Check size={15} />}
              </button>
            </div>
          </div>
          <form
            className="settings-section"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              try {
                await post("/password", Object.fromEntries(new FormData(form)));
                form.reset();
                setNotice(
                  "Password updated. Other sessions have been signed out.",
                );
              } catch (e) {
                setNotice((e as Error).message);
              }
            }}
          >
            <h3>Change password</h3>
            <label>
              Current password
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              New password
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                placeholder="At least 12 characters"
              />
            </label>
            <button className="secondary">
              <Settings size={15} />
              Update password
            </button>
          </form>
          <div className="settings-section">
            <h3>Keyboard shortcuts</h3>
            <p className="muted">
              Ctrl / Cmd + K <span>Search your notes</span>
            </p>
            <p className="muted">
              Ctrl / Cmd + Alt + N <span>Create something new</span>
            </p>
          </div>
          <button
            className="secondary"
            onClick={async () => {
              try {
                await post("/logout");
                setUser(null);
                setSelected(null);
                setModal(null);
              } catch (e) {
                setNotice((e as Error).message);
              }
            }}
          >
            <LogOut size={16} />
            Sign out
          </button>
        </Modal>
      )}
    </div>
  );
}
