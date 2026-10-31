import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "./icons";

interface Props {
  title: string;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
}

export function Modal({ title, onClose, width = 480, children }: Props) {
  const backdrop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // with a dialog opened from another (setup from settings), Escape closes the top one only
      const open = document.querySelectorAll(".backdrop");
      if (e.key === "Escape" && open[open.length - 1] === backdrop.current) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // in <body>, so a dialog opened from another one isn't placed or clipped by it
  return createPortal(
    <div ref={backdrop} className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            <Icon icon={Cancel01Icon} size={15} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmProps {
  count: number;
  onConfirm: (deleteFiles: boolean) => void;
  onClose: () => void;
}

export function ConfirmDelete({ count, onConfirm, onClose }: ConfirmProps) {
  return (
    <Modal title="remove downloads" onClose={onClose} width={420}>
      <p>
        Remove {count === 1 ? "this download" : `${count} downloads`} from the list?
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const deleteFiles = (e.currentTarget.elements.namedItem("files") as HTMLInputElement).checked;
          onConfirm(deleteFiles);
        }}
      >
        <label className="check">
          <input type="checkbox" name="files" />
          <span>also delete the finished files from disk</span>
        </label>
        <p className="hint">the partial data of unfinished downloads is always deleted.</p>
        <div className="modal-actions">
          <div className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            cancel
          </button>
          <button type="submit" className="btn danger" autoFocus>
            remove
          </button>
        </div>
      </form>
    </Modal>
  );
}
