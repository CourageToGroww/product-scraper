import React from "react";

export default function ConfirmModal({
  open, title, children, confirmLabel, confirmColor, onConfirm, onCancel, loading
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  confirmColor: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold m-0 mb-3" style={{ color: "var(--color-text)" }}>{title}</h3>
        <div className="text-sm mb-5" style={{ color: "var(--color-text-muted)", lineHeight: "1.6" }}>
          {children}
        </div>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="btn-ghost">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="btn-primary"
            style={{
              background: confirmColor === "var(--color-error)"
                ? "var(--color-error)" : undefined
            }}
          >
            {loading ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
