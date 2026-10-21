import { useState, type FormEvent } from "react";
import { ArrowRight, Check, Feather, Layers, LockKeyhole } from "lucide-react";
import { post } from "../api";
import type { User } from "../types";
import { Logo } from "./ui";
export default function Auth({ onSignIn }: { onSignIn: (user: User) => void }) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      onSignIn(await post<User>(register ? "/register" : "/login", data));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-story">
        <a className="brand" href="/">
          <Logo />
          Noteselot<span className="tiny-label">YOUR THINKING SPACE</span>
        </a>
        <div className="auth-copy">
          <span className="eyebrow">A LITTLE ROOM FOR BIG IDEAS</span>
          <h1>
            Good thinking
            <br />
            starts here.
          </h1>
          <p>
            A quiet place to collect your thoughts.
            <br />
            An open space to build on them, together.
          </p>
          <div className="sample-note">
            <span className="note-tab">
              <Feather size={15} /> A thought worth keeping
            </span>
            <h3>What if we kept it simple?</h3>
            <p>Less switching tabs. More connecting ideas.</p>
            <div className="sample-check">
              <Check size={15} /> Make room for the next good idea
            </div>
            <div className="sample-line" />
            <div className="sample-line short" />
            <span className="sample-tag">a work in progress</span>
          </div>
        </div>
        <footer>
          <LockKeyhole size={15} /> Your notes. Your server. Your space.
        </footer>
      </div>
      <main className="auth-form">
        <div className="auth-form-inner">
          <span className="section-icon">
            <Layers size={24} />
          </span>
          <h2>{register ? "Make yourself at home." : "Welcome back."}</h2>
          <p>
            {register
              ? "Create your Noteselot account to get started."
              : "Pick up where your thoughts left off."}
          </p>
          <form onSubmit={submit}>
            {register && (
              <label>
                Your name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={80}
                  placeholder="Alex Morgan"
                />
              </label>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                required
                minLength={12}
                maxLength={128}
                placeholder={
                  register ? "At least 12 characters" : "Your password"
                }
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? "Just a moment…"
                : register
                  ? "Create account"
                  : "Sign in"}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="auth-switch">
            {register ? "Already have an account?" : "New around here?"}{" "}
            <button
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register ? "Sign in" : "Create an account"}
            </button>
          </p>
          <div className="auth-footnote">
            <LockKeyhole size={14} /> Accounts are managed on this server.
          </div>
        </div>
      </main>
    </div>
  );
}
