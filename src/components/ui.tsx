import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export function Logo() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 28 28">
        <path d="M5 23V5h4l10 13V5h4v18h-4L9 10v13z" fill="currentColor" />
      </svg>
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar">
      {name
        .split(" ")
        .map((s) => s[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()}
    </span>
  );
}
export const dateLabel = (value: string) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(value),
  );
