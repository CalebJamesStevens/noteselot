import { lazy, Suspense, useEffect, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import {
  ArrowLeft,
  Star,
  MessageSquare,
  History,
  Trash2,
  Cloud,
  CloudOff,
  Check,
  LockKeyhole,
  Users,
  X,
  Send,
  Copy,
} from "lucide-react";
import type { Note, User, Comment } from "../types";
import NoteEditor from "./Editor";
import { api, post } from "../api";
import { Avatar, dateLabel } from "./ui";
const Board = lazy(() => import("./Board"));
const Diagram = lazy(() => import("./Diagram"));
export default function Workspace({
  note,
  user,
  theme,
  onClose,
  onRefresh,
  onError,
}: {
  note: Note;
  user: User;
  theme: string;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onError: (s: string) => void;
}) {
  const [connection] = useState(() => {
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/collaboration`,
      name: note.id,
      document: doc,
      token: "cookie-session",
    });
    return { doc, provider };
  });
  const [status, setStatus] = useState("connecting"),
    [ready, setReady] = useState(false),
    [title, setTitle] = useState(note.title),
    [favorite, setFavorite] = useState(note.favorite),
    [panel, setPanel] = useState<"comments" | "history" | null>(null),
    [comments, setComments] = useState<Comment[]>([]),
    [revisions, setRevisions] = useState<{ id: string; created_at: string }[]>(
      [],
    ),
    [message, setMessage] = useState(""),
    [peers, setPeers] = useState<string[]>([]),
    [sending, setSending] = useState(false);
  const { doc, provider } = connection;
  useEffect(() => {
    const statusChange = ({ status }: { status: string }) =>
      setStatus(status === "connected" ? "connected" : "offline");
    const sync = () => {
      setReady(true);
      setStatus("saved");
    };
    const stateless = ({ payload }: { payload: string }) => {
      try {
        const p = JSON.parse(payload);
        if (["saving", "saved", "save-error"].includes(p.type))
          setStatus(p.type);
      } catch {}
    };
    const denied = () => {
      setStatus("denied");
      onError("Your session expired or access to this note was removed.");
    };
    const awareness = () =>
      setPeers([
        ...new Set(
          Array.from(provider.awareness?.getStates().values() || [])
            .map((s) => s.user?.name)
            .filter((name): name is string => !!name),
        ),
      ]);
    provider.on("close", () => setStatus("offline"));
    provider.on("status", statusChange);
    provider.on("synced", sync);
    provider.on("stateless", stateless);
    provider.on("authenticationFailed", denied);
    provider.awareness?.on("change", awareness);
    provider.setAwarenessField("user", { name: user.name, color: "#a8bb92" });
    if (provider.isSynced) sync();
    return () => {
      provider.off("status", statusChange);
      provider.off("synced", sync);
      provider.off("stateless", stateless);
      provider.off("authenticationFailed", denied);
      provider.awareness?.off("change", awareness);
      provider.destroy();
      doc.destroy();
    };
  }, [doc, provider, user.name]);
  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      if (
        status === "saving" ||
        status === "save-error" ||
        status === "offline"
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);
  useEffect(() => {
    if (!panel) return;
    let live = true;
    async function refresh() {
      try {
        if (panel === "comments") {
          const values = await api<Comment[]>(`/notes/${note.id}/comments`);
          if (live) setComments(values);
        } else {
          const values = await api<{ id: string; created_at: string }[]>(
            `/notes/${note.id}/revisions`,
          );
          if (live) setRevisions(values);
        }
      } catch (e) {
        if (live) onError((e as Error).message);
      }
    }
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [panel, note.id]);
  async function saveTitle() {
    const value = title.trim() || "Untitled";
    setTitle(value);
    if (value === note.title) return;
    try {
      await api(`/notes/${note.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: value }),
      });
      await onRefresh();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function toggleFavorite() {
    try {
      await api(`/notes/${note.id}`, {
        method: "PATCH",
        body: JSON.stringify({ favorite: !favorite }),
      });
      setFavorite(!favorite);
      await onRefresh();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  function close() {
    if (
      ["offline", "save-error", "saving"].includes(status) &&
      !confirm("Some changes may not be saved. Leave this note?")
    )
      return;
    onClose();
  }
  return (
    <section
      className={`workspace ${note.kind !== "note" ? "canvas-workspace" : ""}`}
    >
      <header className="workspace-topbar">
        <button
          className="icon-button"
          aria-label="Back to notes"
          onClick={close}
        >
          <ArrowLeft size={20} />
        </button>
        <span className="breadcrumb">
          {note.team_id ? <Users size={14} /> : <LockKeyhole size={14} />}{" "}
          {note.team_id ? "Team space" : "Personal"} <span>/</span>{" "}
          <strong>{title}</strong>
        </span>
        <div className="topbar-actions">
          <span
            className={`save-status ${["offline", "denied", "save-error"].includes(status) ? "warning" : ""}`}
          >
            {status === "saved" ? (
              <Check size={14} />
            ) : status === "offline" ? (
              <CloudOff size={14} />
            ) : (
              <Cloud size={14} />
            )}
            {
              {
                saved: "All changes saved",
                saving: "Saving…",
                offline: "Offline · keep this tab open",
                connected: "Connected",
                connecting: "Connecting…",
                denied: "Access denied",
                "save-error": "Save failed · keep this tab open",
              }[status]
            }
          </span>
          <button
            className={`icon-button ${favorite ? "is-favorite" : ""}`}
            title="Favorite"
            aria-label="Favorite"
            aria-pressed={favorite}
            onClick={toggleFavorite}
          >
            <Star size={18} fill={favorite ? "currentColor" : "none"} />
          </button>
          <button
            className={`icon-button ${panel === "comments" ? "active" : ""}`}
            title="Comments"
            aria-label="Comments"
            onClick={() => setPanel(panel === "comments" ? null : "comments")}
          >
            <MessageSquare size={18} />
          </button>
          <button
            className="icon-button"
            title="Version history"
            aria-label="Version history"
            onClick={() => setPanel(panel === "history" ? null : "history")}
          >
            <History size={18} />
          </button>
          <button
            className="icon-button"
            title="Move to trash"
            aria-label="Move to trash"
            onClick={async () => {
              if (!confirm("Move this note to trash?")) return;
              try {
                await api(`/notes/${note.id}`, { method: "DELETE" });
                await onRefresh();
                onClose();
              } catch (e) {
                onError((e as Error).message);
              }
            }}
          >
            <Trash2 size={18} />
          </button>
        </div>
      </header>
      <div className="workspace-body">
        <div className="document-area">
          <div className="document-heading">
            <div className="document-kicker">
              {note.kind === "board"
                ? "ROOM TO EXPLORE"
                : note.kind === "diagram"
                  ? "CONNECT YOUR THINKING"
                  : "A THOUGHT WORTH KEEPING"}
            </div>
            <input
              className="document-title"
              aria-label="Note title"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
            <div className="document-meta">
              <span>
                {note.kind === "note"
                  ? "Note"
                  : note.kind === "board"
                    ? "Whiteboard"
                    : "Diagram"}
              </span>
              <span className="meta-dot" />
              <span>Edited {dateLabel(note.updated_at)}</span>
              <div className="collaborators">
                {peers.slice(0, 4).map((name) => (
                  <span title={name} key={name}>
                    <Avatar name={name} />
                  </span>
                ))}
                <span>
                  {peers.length > 1
                    ? `${peers.length} here together`
                    : "Just you here"}
                </span>
              </div>
            </div>
          </div>
          {!ready ? (
            <div className="empty">
              <Cloud size={30} />
              <p>
                {status === "denied"
                  ? "Access denied. Return to your notes."
                  : "Connecting to your note…"}
              </p>
            </div>
          ) : (
            <Suspense
              fallback={<div className="empty">Opening your workspace…</div>}
            >
              {note.kind === "board" ? (
                <Board doc={doc} title={title} />
              ) : note.kind === "diagram" ? (
                <Diagram doc={doc} title={title} theme={theme} />
              ) : (
                <NoteEditor
                  doc={doc}
                  provider={provider}
                  note={note}
                  user={user}
                />
              )}
            </Suspense>
          )}
        </div>
        {panel && (
          <aside className="side-panel">
            <header>
              <h3>
                {panel === "comments" ? "Conversation" : "Version history"}
              </h3>
              <button
                className="icon-button"
                aria-label="Close panel"
                onClick={() => setPanel(null)}
              >
                <X size={18} />
              </button>
            </header>
            {panel === "comments" ? (
              <>
                <div className="comment-list">
                  {comments.length === 0 && (
                    <div className="empty">
                      <MessageSquare size={28} />
                      <h4>Start a conversation.</h4>
                      <p>Questions, feedback, and little sparks.</p>
                    </div>
                  )}
                  {comments.map((c) => (
                    <article className="comment" key={c.id}>
                      <Avatar name={c.name} />
                      <div>
                        <strong>{c.name}</strong>
                        <time>{dateLabel(c.created_at)}</time>
                        <p>{c.body}</p>
                      </div>
                    </article>
                  ))}
                </div>
                <form
                  className="comment-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!message.trim() || sending) return;
                    setSending(true);
                    try {
                      await post(`/notes/${note.id}/comments`, {
                        body: message,
                      });
                      setMessage("");
                      setComments(
                        await api<Comment[]>(`/notes/${note.id}/comments`),
                      );
                    } catch (e) {
                      onError((e as Error).message);
                    } finally {
                      setSending(false);
                    }
                  }}
                >
                  <textarea
                    aria-label="Comment"
                    placeholder="Add to the conversation…"
                    value={message}
                    maxLength={4000}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <button
                    className="primary"
                    disabled={sending || !message.trim()}
                  >
                    Post comment
                    <Send size={15} />
                  </button>
                </form>
              </>
            ) : (
              <div className="revision-list">
                <p className="muted">
                  Snapshots are kept every five minutes while editing. Recover a
                  version as a new note.
                </p>
                {revisions.map((r) => (
                  <button
                    key={r.id}
                    onClick={async () => {
                      try {
                        await post(`/notes/${note.id}/revisions/${r.id}/copy`);
                        await onRefresh();
                        onError(
                          "Recovered as a new note. You can find it in your notes.",
                        );
                      } catch (e) {
                        onError((e as Error).message);
                      }
                    }}
                  >
                    <History size={18} />
                    <span>{new Date(r.created_at).toLocaleString()}</span>
                    <Copy size={15} />
                  </button>
                ))}
                {revisions.length === 0 && (
                  <p className="muted">
                    Your first snapshot will appear after you edit.
                  </p>
                )}
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
