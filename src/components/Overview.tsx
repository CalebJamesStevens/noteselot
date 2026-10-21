import {
  ArrowDownWideNarrow,
  ArrowRight,
  ChevronRight,
  FileText,
  GitBranch,
  LayoutGrid,
  List,
  LockKeyhole,
  Plus,
  Search,
  Star,
  StickyNote,
  Trash2,
  Users,
  CalendarDays,
  Lightbulb,
  FolderOpen,
  RotateCcw,
} from "lucide-react";
import { post } from "../api";
import type { User, Team, Note, Kind } from "../types";
import { dateLabel } from "./ui";
import FeatherIcon from "./FeatherIcon";
const kinds = { note: FileText, board: StickyNote, diagram: GitBranch };
interface OverviewProps {
  activeTeam: Team | undefined;
  view: string;
  query: string;
  user: User;
  title: string;
  setModal: (value: "create" | "members") => void;
  create: (kind: Kind, template?: string) => Promise<void>;
  visible: Note[];
  layout: string;
  sort: string;
  setSort: (value: string) => void;
  setLayout: (value: string) => void;
  navigate: (value: string) => void;
  teams: Team[];
  setSelected: (value: string) => void;
  refresh: () => Promise<void>;
  setNotice: (value: string) => void;
}
export default function Overview({
  activeTeam,
  view,
  query,
  user,
  title,
  setModal,
  create,
  visible,
  layout,
  sort,
  setSort,
  setLayout,
  navigate,
  teams,
  setSelected,
  refresh,
  setNotice,
}: OverviewProps) {
  return (
    <>
      <header className="page-topbar">
        <div>
          <span className="muted">Workspace</span>
          <ChevronRight size={14} />
          <span>
            {activeTeam
              ? "Team space"
              : view === "home"
                ? "Overview"
                : view === "personal"
                  ? "Personal"
                  : view === "favorites"
                    ? "Favorites"
                    : view === "trash"
                      ? "Trash"
                      : "Overview"}
          </span>
        </div>
        <span className="server-badge">
          <span />
          Your private corner of the internet
        </span>
      </header>
      <div className="overview">
        <section className="page-heading">
          <div>
            <div className="eyebrow">
              {query
                ? "FIND THAT THOUGHT"
                : view === "home"
                  ? `MAKE YOURSELF AT HOME, ${user.name.split(" ")[0].toUpperCase()}`
                  : activeTeam
                    ? "BETTER IDEAS, TOGETHER"
                    : view === "trash"
                      ? "NOT GONE, JUST OUT OF THE WAY"
                      : "MAKE ROOM FOR WHAT MATTERS"}
            </div>
            <h1>
              {title}
              <span className="heading-period">.</span>
            </h1>
            <p>
              {query
                ? `Notes matching “${query}”`
                : activeTeam
                  ? "Shared thoughts. Fresh perspectives. A place to work things out."
                  : view === "trash"
                    ? "Restore a note whenever you need it."
                    : view === "favorites"
                      ? "The thoughts you want to keep close."
                      : "Capture a thought, make a plan, or see where an idea takes you."}
            </p>
          </div>
          {activeTeam ? (
            <button className="secondary" onClick={() => setModal("members")}>
              <Users size={17} />
              Members
            </button>
          ) : (
            <span className="heading-doodle">
              <FeatherIcon />
            </span>
          )}
        </section>
        {!query && view !== "trash" && view !== "favorites" && (
          <section className="quick-create" aria-label="Create something">
            <button
              className="create-card note-create"
              onClick={() => create("note")}
            >
              <span className="create-icon">
                <FileText size={23} />
              </span>
              <span>
                <strong>A fresh note</strong>
                <small>For whatever’s on your mind</small>
              </span>
              <Plus size={18} />
            </button>
            <button
              className="create-card board-create"
              onClick={() => create("board")}
            >
              <span className="create-icon">
                <StickyNote size={23} />
              </span>
              <span>
                <strong>Room to brainstorm</strong>
                <small>Spread out on a whiteboard</small>
              </span>
              <Plus size={18} />
            </button>
            <button
              className="create-card diagram-create"
              onClick={() => create("diagram")}
            >
              <span className="create-icon">
                <GitBranch size={23} />
              </span>
              <span>
                <strong>Connect the dots</strong>
                <small>Bring a process into focus</small>
              </span>
              <Plus size={18} />
            </button>
          </section>
        )}
        <section className="notes-section">
          <div className="section-heading">
            <div className="section-tabs">
              <button className="active">
                {query
                  ? "Results"
                  : view === "trash"
                    ? "Trash"
                    : view === "home"
                      ? "All notes"
                      : view === "favorites"
                        ? "Favorites"
                        : "Notes"}
                <span>{visible.length}</span>
              </button>
              {view === "home" && !query && (
                <button onClick={() => navigate("personal")}>Personal</button>
              )}
            </div>
            <div className="list-controls">
              <ArrowDownWideNarrow size={15} />
              <select
                aria-label="Sort notes"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="recent">Last edited</option>
                <option value="alpha">Title A–Z</option>
              </select>
              <span className="toolbar-divider" />
              <button
                className={layout === "grid" ? "active" : ""}
                title="Grid view"
                aria-label="Grid view"
                onClick={() => setLayout("grid")}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                className={layout === "list" ? "active" : ""}
                title="List view"
                aria-label="List view"
                onClick={() => setLayout("list")}
              >
                <List size={17} />
              </button>
              {view !== "trash" && (
                <button
                  className="primary small"
                  onClick={() => setModal("create")}
                >
                  <Plus size={16} />
                  New
                </button>
              )}
            </div>
          </div>
          {visible.length ? (
            <div className={`notes-${layout}`}>
              {visible.map((n) => {
                const Icon = kinds[n.kind];
                return (
                  <article key={n.id} className={`note-card kind-${n.kind}`}>
                    <button
                      className="note-open"
                      onClick={() => {
                        if (view !== "trash") setSelected(n.id);
                      }}
                    >
                      <div className="note-card-top">
                        <span className={`note-type-icon ${n.kind}`}>
                          <Icon size={20} />
                        </span>
                        {n.favorite && (
                          <Star
                            size={14}
                            className="is-favorite"
                            fill="currentColor"
                          />
                        )}
                        <span className="note-type-name">
                          {n.kind === "board"
                            ? "WHITEBOARD"
                            : n.kind === "diagram"
                              ? "DIAGRAM"
                              : "NOTE"}
                        </span>
                      </div>
                      <h3>{n.title}</h3>
                      <p>
                        {n.excerpt?.trim() ||
                          (n.kind === "board"
                            ? "A little space to see the bigger picture."
                            : n.kind === "diagram"
                              ? "Every connection starts with an idea."
                              : "Something good starts with a blank page.")}
                      </p>
                      <footer>
                        <span>
                          {n.team_id ? (
                            <Users size={12} />
                          ) : (
                            <LockKeyhole size={12} />
                          )}{" "}
                          {n.team_id
                            ? teams.find((t) => t.id === n.team_id)?.name
                            : "Personal"}
                        </span>
                        <time>{dateLabel(n.updated_at)}</time>
                      </footer>
                    </button>
                    {view === "trash" && (
                      <button
                        className="restore-button"
                        onClick={async () => {
                          try {
                            await post(`/trash/${n.id}/restore`);
                            await refresh();
                          } catch (e) {
                            setNotice((e as Error).message);
                          }
                        }}
                      >
                        <RotateCcw size={14} />
                        Restore
                      </button>
                    )}
                  </article>
                );
              })}
              {view !== "trash" && !query && (
                <button
                  className="new-note-tile"
                  onClick={() => setModal("create")}
                >
                  <Plus size={23} />
                  <span>A little room for something new</span>
                </button>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-symbol">
                {view === "trash" ? (
                  <Trash2 size={28} />
                ) : query ? (
                  <Search size={28} />
                ) : (
                  <FileText size={28} />
                )}
              </span>
              <h2>
                {query
                  ? "No thoughts found."
                  : view === "trash"
                    ? "Nothing in the trash."
                    : view === "favorites"
                      ? "Keep your best thoughts close."
                      : "Your first idea belongs here."}
              </h2>
              <p>
                {query
                  ? "Try a different word or phrase."
                  : view === "trash"
                    ? "Notes you set aside will appear here."
                    : view === "favorites"
                      ? "Star a note to find it here."
                      : "Start from scratch, or give yourself a head start with a template."}
              </p>
              {!query && view !== "trash" && view !== "favorites" && (
                <button className="primary" onClick={() => setModal("create")}>
                  <Plus size={16} />
                  Create your first note
                </button>
              )}
            </div>
          )}
        </section>
        {!query && view !== "trash" && view !== "favorites" && (
          <section className="templates-section">
            <div className="template-heading">
              <div>
                <span className="eyebrow">SKIP THE BLANK PAGE</span>
                <h2>A small head start.</h2>
              </div>
              <span className="muted">
                A little structure. Plenty of possibility.
              </span>
            </div>
            <div className="template-grid">
              {[
                {
                  key: "meeting",
                  title: "Meeting of minds",
                  text: "Agenda, decisions, and what comes next.",
                  Icon: CalendarDays,
                },
                {
                  key: "ideas",
                  title: "A spark of something",
                  text: "Turn a passing thought into a possibility.",
                  Icon: Lightbulb,
                },
                {
                  key: "project",
                  title: "A plan taking shape",
                  text: "The why, the what, and the next steps.",
                  Icon: FolderOpen,
                },
              ].map((t) => (
                <button
                  key={t.key}
                  className="template-card"
                  onClick={() => create("note", t.key)}
                >
                  <t.Icon size={21} />
                  <span>
                    <strong>{t.title}</strong>
                    <small>{t.text}</small>
                  </span>
                  <ArrowRight size={17} />
                </button>
              ))}
            </div>
          </section>
        )}
        <footer className="overview-footer">
          <span>Good ideas need a place to land.</span>
          <span>
            Noteselot <span className="meta-dot" /> Made for a little clarity
          </span>
        </footer>
      </div>
    </>
  );
}
