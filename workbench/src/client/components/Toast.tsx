import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";

type ToastVariant = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  exiting?: boolean;
}

interface ToastCtx {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastCtx>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const VARIANT_STYLES: Record<ToastVariant, { bg: string; border: string; icon: string }> = {
  success: { bg: "var(--color-success-glow)", border: "rgba(34, 197, 94, 0.3)", icon: "\u2713" },
  error:   { bg: "var(--color-error-glow)",   border: "rgba(239, 68, 68, 0.3)",  icon: "\u2717" },
  info:    { bg: "var(--color-primary-glow)",  border: "rgba(6, 182, 212, 0.3)",  icon: "\u2139" },
  warning: { bg: "var(--color-warning-glow)",  border: "rgba(234, 179, 8, 0.3)",  icon: "\u26A0" }
};

const VARIANT_COLORS: Record<ToastVariant, string> = {
  success: "var(--color-success)",
  error: "var(--color-error)",
  info: "var(--color-primary)",
  warning: "var(--color-warning)"
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const toast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, { id, message, variant }]);
    // Start exit animation, then remove
    setTimeout(() => setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t)), 3500);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={{
        position: "fixed", top: "1rem", right: "1rem", zIndex: 9999,
        display: "flex", flexDirection: "column", gap: "0.5rem",
        pointerEvents: "none", maxWidth: "380px", width: "100%"
      }}>
        {toasts.map(t => {
          const styles = VARIANT_STYLES[t.variant];
          return (
            <div
              key={t.id}
              style={{
                background: "var(--color-surface-raised)",
                border: `1px solid ${styles.border}`,
                borderRadius: "var(--radius-lg)",
                padding: "0.75rem 1rem",
                display: "flex",
                alignItems: "center",
                gap: "0.625rem",
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
                animation: t.exiting ? "toast-out 0.3s ease forwards" : "toast-in 0.3s ease",
                pointerEvents: "auto",
              }}
            >
              <span style={{
                color: VARIANT_COLORS[t.variant],
                fontSize: "0.875rem", fontWeight: 700,
                width: "1.25rem", textAlign: "center", flexShrink: 0
              }}>
                {styles.icon}
              </span>
              <span style={{ color: "var(--color-text)", fontSize: "0.8125rem", lineHeight: 1.4 }}>
                {t.message}
              </span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
