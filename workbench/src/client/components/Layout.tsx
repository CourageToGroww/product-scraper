import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";

/* Inline SVG icons — lightweight, no dependency */
const Icons = {
  scrapes: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    </svg>
  ),
  datasets: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  dashboards: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" />
    </svg>
  ),
  infra: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" />
      <circle cx="6" cy="6" r="1" fill="currentColor" /><circle cx="6" cy="18" r="1" fill="currentColor" />
    </svg>
  ),
  merges: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
};

const NAV_ITEMS = [
  { path: "/scrapes", label: "Scrapes", icon: Icons.scrapes },
  { path: "/datasets", label: "Datasets", icon: Icons.datasets },
  { path: "/dashboards", label: "Dashboards", icon: Icons.dashboards },
  { path: "/databases", label: "Infra", icon: Icons.infra },
  { path: "/merges", label: "Merges", icon: Icons.merges }
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [studioUrl, setStudioUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config").then(r => r.json())
      .then(d => { if (d.studioUrl) setStudioUrl(d.studioUrl); })
      .catch(() => {});
  }, []);

  return (
    <div className="flex min-h-screen" style={{ background: "var(--color-surface)" }}>
      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-30 transform transition-all duration-200
          lg:relative lg:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
        style={{
          width: sidebarCollapsed ? "3.5rem" : "14rem",
          minWidth: sidebarCollapsed ? "3.5rem" : "14rem",
          background: "var(--color-surface-raised)",
          borderRight: "1px solid var(--color-border)"
        }}
      >
        {/* Logo */}
        <div className="p-4 pb-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--color-border)" }}>
          {!sidebarCollapsed && (
            <Link to="/" className="no-underline flex items-center gap-2">
              <div style={{
                width: 28, height: 28,
                background: "var(--color-primary-dark)",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 7l7-4 7 4M4 7v10l7 4M4 7l7 4m7-4v10l-7 4m7-14l-7 4m0 0v10" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-bold" style={{ color: "var(--color-text)", letterSpacing: "-0.02em" }}>ScrapeKit</div>
                <div style={{ color: "var(--color-text-muted)", fontSize: "0.625rem", marginTop: "-1px" }}>Workbench</div>
              </div>
            </Link>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="hidden lg:flex"
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              color: "var(--color-text-muted)", padding: "0.25rem",
              display: "inline-flex", alignItems: "center",
              margin: sidebarCollapsed ? "0 auto" : undefined
            }}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {sidebarCollapsed
                ? <><path d="M13 17l5-5-5-5" /><path d="M6 17l5-5-5-5" /></>
                : <><path d="M11 7l-5 5 5 5" /><path d="M18 7l-5 5 5 5" /></>
              }
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="p-2 mt-1">
          {NAV_ITEMS.map(item => {
            const active = location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center ${sidebarCollapsed ? "justify-center px-0" : "px-3"} gap-2.5 py-2 text-sm no-underline mb-0.5`}
                style={{
                  color: active ? "var(--color-primary)" : "var(--color-text-muted)",
                  background: active ? "var(--color-primary-glow)" : "transparent",
                  fontWeight: active ? 600 : 400,
                  borderLeft: active ? "2px solid var(--color-primary)" : "2px solid transparent",
                  transition: "all 0.15s ease"
                }}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <span style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>{item.icon}</span>
                {!sidebarCollapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Footer with Settings + Drizzle Studio links */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          padding: sidebarCollapsed ? "0.5rem" : "0.75rem 1rem",
          borderTop: "1px solid var(--color-border)",
          display: "flex", flexDirection: "column", gap: "0.5rem"
        }}>
          {/* Settings link */}
          <Link
            to="/settings"
            onClick={() => setSidebarOpen(false)}
            className={`flex items-center ${sidebarCollapsed ? "justify-center" : "gap-2 px-3"} py-2 text-xs no-underline`}
            style={{
              color: location.pathname === "/settings" ? "var(--color-primary)" : "var(--color-text-muted)",
              background: location.pathname === "/settings" ? "var(--color-primary-glow)" : "transparent",
              transition: "all 0.15s ease",
              fontWeight: 500
            }}
            title={sidebarCollapsed ? "Settings" : undefined}
          >
            <span style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </span>
            {!sidebarCollapsed && "Settings"}
          </Link>

          {/* Drizzle Studio link */}
          {!sidebarCollapsed && studioUrl && (
            <a
              href={studioUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 text-xs no-underline"
              style={{
                color: "var(--color-text-muted)",
                background: "var(--color-surface-glass)",
                border: "1px solid var(--color-border)",
                transition: "all 0.15s ease",
                fontWeight: 500
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = "var(--color-primary)";
                e.currentTarget.style.color = "var(--color-primary)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = "var(--color-border)";
                e.currentTarget.style.color = "var(--color-text-muted)";
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
                <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
              </svg>
              Drizzle Studio
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ marginLeft: "auto", opacity: 0.5 }}>
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <path d="M15 3h6v6" /><path d="M10 14 21 3" />
              </svg>
            </a>
          )}
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 lg:hidden"
          style={{ background: "rgba(0, 0, 0, 0.6)" }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar (mobile/tablet) */}
        <header
          className="flex items-center gap-3 px-4 py-3 lg:hidden"
          style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-surface-raised)" }}
        >
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5"
            style={{
              color: "var(--color-text)", background: "transparent",
              border: "1px solid var(--color-border)", cursor: "pointer"
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          </button>
          <span className="text-sm font-bold" style={{ color: "var(--color-primary)" }}>ScrapeKit</span>
        </header>

        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-auto pb-20 md:pb-6">
          {children}
        </main>
      </div>

      {/* Bottom tab bar (mobile) */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-10 flex md:hidden"
        style={{
          background: "var(--color-surface-raised)",
          borderTop: "1px solid var(--color-border)"
        }}
      >
        {NAV_ITEMS.map(item => {
          const active = location.pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className="flex-1 flex flex-col items-center py-2.5 no-underline"
              style={{
                color: active ? "var(--color-primary)" : "var(--color-text-muted)",
                transition: "color 0.15s ease"
              }}
            >
              <span style={{ display: "flex" }}>{item.icon}</span>
              <span style={{ fontSize: "0.625rem", marginTop: "2px" }}>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
