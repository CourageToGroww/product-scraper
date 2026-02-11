import React from "react";

export default function Tooltip({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <span className="tooltip-wrap">
      {children || (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          style={{ opacity: 0.35, marginLeft: "4px", verticalAlign: "-1px", flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
        </svg>
      )}
      <span className="tooltip-text">{text}</span>
    </span>
  );
}
