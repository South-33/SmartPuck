import {
  useCallback,
  useEffect,
  useRef,
  useState,
  memo,
  type RefObject,
} from "react";
import { useI18n } from "../../components/useI18n";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Check,
  Folder,
  Loader,
  Pencil,
  Plus,
  X,
} from "../../assets/icons";
import type { SmartPuckFolder } from "../../../../shared/smartpuck-library";

interface RecentSession {
  id: string;
  title: string;
  contextFolder?: string | null;
}

// ChatGPT-style paged conversation list under the pinned app navigation.
export const RECENT_SESSIONS_PAGE_SIZE = 30;

// Re-sync cadence while the list is visible. Deliberately slower than the
// Sessions screen (30s) — the sidebar is always on screen, so this interval
// runs for the whole app lifetime when the section is expanded.
const RECENT_REFRESH_MS = 60_000;

// Minimum gap between event-driven refreshes (focus, session switch) so a
// burst of focus/blur events doesn't hammer state.db.
const REFRESH_THROTTLE_MS = 5_000;
const INFINITE_SCROLL_THRESHOLD_PX = 180;
const FOLDERS_CLOSED_KEY = "hermes.sidebar.closedProjectFolders";
const FOLDER_ORDER_KEY = "hermes.sidebar.folderOrder";
const SESSION_ORDER_KEY = "hermes.sidebar.sessionOrder";

function readStoredClosedFolders(): Set<string> {
  try {
    const raw = localStorage.getItem(FOLDERS_CLOSED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(String) : []);
  } catch {
    return new Set();
  }
}

function storeClosedFolders(paths: Set<string>): void {
  try {
    localStorage.setItem(FOLDERS_CLOSED_KEY, JSON.stringify(Array.from(paths)));
  } catch {
    /* ignore persistence failures */
  }
}

function readStoredOrder(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function moveBefore(order: string[], source: string, target: string, ids: string[]): string[] {
  const normalized = [
    ...order.filter((id) => ids.includes(id)),
    ...ids.filter((id) => !order.includes(id)),
  ];
  const next = normalized.filter((id) => id !== source);
  const index = next.indexOf(target);
  next.splice(index < 0 ? next.length : index, 0, source);
  return next;
}

function sameSessions(a: RecentSession[], b: RecentSession[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].id !== b[i].id ||
      a[i].title !== b[i].title ||
      (a[i].contextFolder ?? null) !== (b[i].contextFolder ?? null)
    ) {
      return false;
    }
  }
  return true;
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || path;
}

function groupSessionsByWorkspace(
  sessions: RecentSession[],
  folders: SmartPuckFolder[],
): {
  projectGroups: Array<{
    id: string;
    path: string;
    name: string;
    sessions: RecentSession[];
  }>;
} {
  const projects = new Map(
    folders.map((folder) => [
      folder.path,
      { id: folder.id, name: folder.name, sessions: [] as RecentSession[] },
    ]),
  );

  for (const session of sessions) {
    const contextFolder = session.contextFolder?.trim();
    if (!contextFolder) continue;
    const existing = projects.get(contextFolder);
    if (existing) existing.sessions.push(session);
  }

  return {
    projectGroups: Array.from(projects.entries()).map(([path, group]) => ({
      id: group.id,
      path,
      name: group.name || folderName(path),
      sessions: group.sessions,
    })),
  };
}

/**
 * Recent-sessions list rendered under the "Sessions" nav item in the sidebar
 * (like ChatGPT's sidebar chat list). Owns its own data so Layout re-renders
 * (view switches, update banners, …) never trigger fetches, and `memo` keeps
 * it off the render hot path entirely.
 *
 * Fetch strategy, cheapest first:
 *  - on open: instant read from the sessions.json cache (no DB), then one
 *    sync against state.db to pick up sessions created since the last sync
 *  - while open: refresh on window focus and on a slow interval, throttled
 *  - closed (collapsed section or icon-only sidebar): zero work, renders null
 */
const SidebarRecentSessions = memo(function SidebarRecentSessions({
  open,
  activeProfile,
  currentSessionId,
  loadingSessionIds,
  resumingSessionId,
  onSelect,
  folders,
  onNewFolderChat,
  onCreateFolder,
  onRenameFolder,
  onRenameSession,
  onArchiveFolder,
  onArchiveSession,
  scrollRootRef,
}: {
  open: boolean;
  /** Active profile — the list is per-profile, so switching forces a reload. */
  activeProfile: string;
  currentSessionId: string | null;
  /** Session ids of every run currently generating (multiple run at once). */
  loadingSessionIds: Set<string>;
  /** A session whose history is being fetched for resume (transient spinner). */
  resumingSessionId: string | null;
  onSelect: (sessionId: string) => void;
  folders: SmartPuckFolder[];
  onNewFolderChat: (folderPath: string, folderName: string) => void;
  onCreateFolder: (name: string) => Promise<void>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
  onRenameSession: (sessionId: string, title: string) => Promise<void>;
  onArchiveFolder?: (folderId: string) => Promise<void>;
  onArchiveSession?: (sessionId: string) => Promise<void>;
  /** Scroll container owned by Layout; nearing its bottom loads the next page. */
  scrollRootRef: RefObject<HTMLDivElement | null>;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  // True when the profile has more cache rows than the sidebar has loaded.
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const projectsOpen = true;
  const [folderOrder, setFolderOrder] = useState<string[]>(() =>
    readStoredOrder(`${FOLDER_ORDER_KEY}.${activeProfile}`),
  );
  const [sessionOrder, setSessionOrder] = useState<string[]>(() =>
    readStoredOrder(`${SESSION_ORDER_KEY}.${activeProfile}`),
  );
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null);
  const [closedProjectFolders, setClosedProjectFolders] = useState<Set<string>>(
    () => readStoredClosedFolders(),
  );
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderDraft, setFolderDraft] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const lastRefreshRef = useRef(0);
  const sessionsRef = useRef<RecentSession[]>([]);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    setFolderOrder(readStoredOrder(`${FOLDER_ORDER_KEY}.${activeProfile}`));
    setSessionOrder(readStoredOrder(`${SESSION_ORDER_KEY}.${activeProfile}`));
  }, [activeProfile]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  const normalizeRows = useCallback(
    (
      list: Array<{
        id: string;
        title: string;
        contextFolder?: string | null;
      }>,
      limit = RECENT_SESSIONS_PAGE_SIZE,
    ): RecentSession[] =>
      list.slice(0, limit).map(({ id, title, contextFolder }) => ({
        id,
        title,
        contextFolder: contextFolder ?? null,
      })),
    [],
  );

  const applyFirstPage = useCallback(
    (
      list: Array<{
        id: string;
        title: string;
        contextFolder?: string | null;
      }>,
    ): void => {
      setHasMore(list.length > RECENT_SESSIONS_PAGE_SIZE);
      const next = normalizeRows(list);
      // Skip the state update (and re-render) when nothing changed — the
      // common case for periodic refreshes.
      setSessions((prev) => (sameSessions(prev, next) ? prev : next));
    },
    [normalizeRows],
  );

  const applyLoadedWindow = useCallback(
    (
      list: Array<{
        id: string;
        title: string;
        contextFolder?: string | null;
      }>,
    ): void => {
      const loadedLimit = Math.max(
        RECENT_SESSIONS_PAGE_SIZE,
        sessionsRef.current.length,
      );
      setHasMore(list.length > loadedLimit);
      const next = normalizeRows(list, loadedLimit);
      setSessions((prev) => (sameSessions(prev, next) ? prev : next));
    },
    [normalizeRows],
  );

  const appendPage = useCallback(
    (
      list: Array<{
        id: string;
        title: string;
        contextFolder?: string | null;
      }>,
    ): void => {
      setHasMore(list.length > RECENT_SESSIONS_PAGE_SIZE);
      const page = normalizeRows(list);
      if (page.length === 0) return;
      setSessions((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        const next = [...prev];
        for (const session of page) {
          if (!seen.has(session.id)) next.push(session);
        }
        return sameSessions(prev, next) ? prev : next;
      });
    },
    [normalizeRows],
  );

  const refresh = useCallback(
    async (force = false): Promise<void> => {
      const now = Date.now();
      if (!force && now - lastRefreshRef.current < REFRESH_THROTTLE_MS) return;
      lastRefreshRef.current = now;
      try {
        const synced = await window.hermesAPI.syncSessionCache();
        applyLoadedWindow(synced);
      } catch {
        // keep whatever we had — the list is best-effort UI sugar
      }
    },
    [applyLoadedWindow],
  );

  const loadNextPage = useCallback(async (): Promise<void> => {
    if (!open || !hasMoreRef.current || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const nextPage = await window.hermesAPI.listCachedSessions(
        RECENT_SESSIONS_PAGE_SIZE + 1,
        sessionsRef.current.length,
      );
      appendPage(nextPage);
    } catch {
      // keep the current list; scrolling can retry on the next event
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [appendPage, open]);

  const maybeLoadNextPage = useCallback((): void => {
    const root = scrollRootRef.current;
    if (!projectsOpen) return;
    if (!root || !hasMoreRef.current || loadingMoreRef.current) return;
    const remaining = root.scrollHeight - root.scrollTop - root.clientHeight;
    if (remaining <= INFINITE_SCROLL_THRESHOLD_PX) void loadNextPage();
  }, [loadNextPage, projectsOpen, scrollRootRef]);

  // Initial load when the section opens: paint from the JSON cache
  // immediately (no DB access), then sync once for anything new.
  // Sequenced so sync always wins over cache (avoids race where stale
  // cache overwrites fresh sync if sync resolves first).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const cached = await window.hermesAPI.listCachedSessions(
          // One over the page size so the cache read alone can decide whether
          // another page exists without a separate count query.
          RECENT_SESSIONS_PAGE_SIZE + 1,
        );
        if (!cancelled) applyFirstPage(cached);
      } catch {
        /* ignore cache read errors */
      }
      lastRefreshRef.current = Date.now();
      try {
        const synced = await window.hermesAPI.syncSessionCache();
        if (!cancelled) applyFirstPage(synced);
      } catch {
        // cache read above already painted something
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, activeProfile, applyFirstPage]);

  // While open: pick up background sessions (gateway, cron, other devices)
  // on focus and on a slow timer. No listeners or timers at all when closed.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void refresh(), RECENT_REFRESH_MS);
    const onFocus = (): void => {
      void refresh();
    };
    const onContextFolderChanged = (): void => {
      void refresh(true);
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener(
      "hermes-session-context-folder-changed",
      onContextFolderChanged,
    );
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(
        "hermes-session-context-folder-changed",
        onContextFolderChanged,
      );
    };
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const root = scrollRootRef.current;
    if (!root) return;
    const onScroll = (): void => {
      maybeLoadNextPage();
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    maybeLoadNextPage();
    return () => {
      root.removeEventListener("scroll", onScroll);
    };
  }, [maybeLoadNextPage, open, scrollRootRef]);

  // If the first page does not fill the sidebar, keep paging until the scroll
  // container has real overflow or the cache runs out.
  useEffect(() => {
    if (open) maybeLoadNextPage();
  }, [hasMore, maybeLoadNextPage, open, sessions.length]);

  // Resuming/switching sessions reorders recency — refresh (throttled).
  // Also refreshes when going to "New Chat" (currentSessionId becomes null)
  // so the just-left session appears in the list immediately.
  useEffect(() => {
    if (open) void refresh();
  }, [open, currentSessionId, refresh]);

  // Switching agent points the list at a different profile's DB. Force a
  // reload immediately (bypassing the throttle) so the list isn't stale.
  const prevProfileRef = useRef(activeProfile);
  useEffect(() => {
    if (prevProfileRef.current === activeProfile) return;
    prevProfileRef.current = activeProfile;
    void refresh(true);
  }, [activeProfile, refresh]);

  // Listen for native context menu events
  useEffect(() => {
    if (!open) return;

    const cleanupRenameFolder = window.hermesAPI.smartPuck.onRenameFolderRequested(
      (folderId, folderName) => {
        setEditingFolderId(folderId);
        setRenameDraft(folderName);
      }
    );

    const cleanupArchiveFolder = window.hermesAPI.smartPuck.onArchiveFolderRequested(
      async (folderId) => {
        if (onArchiveFolder) {
          await onArchiveFolder(folderId);
        }
      }
    );

    const cleanupNewFolderChat = window.hermesAPI.smartPuck.onNewFolderChatRequested(
      (folderPath, folderName) => {
        onNewFolderChat(folderPath, folderName);
      }
    );

    const cleanupRenameSession = window.hermesAPI.smartPuck.onRenameSessionRequested(
      (sessionId, sessionTitle) => {
        setEditingSessionId(sessionId);
        setRenameDraft(sessionTitle);
      }
    );

    const cleanupArchiveSession = window.hermesAPI.smartPuck.onArchiveSessionRequested(
      async (sessionId, sessionTitle) => {
        if (window.confirm(`Archive chat "${sessionTitle}"?`)) {
          if (onArchiveSession) {
            await onArchiveSession(sessionId);
          }
          void refresh(true);
        }
      }
    );

    return () => {
      cleanupRenameFolder();
      cleanupArchiveFolder();
      cleanupNewFolderChat();
      cleanupRenameSession();
      cleanupArchiveSession();
    };
  }, [open, onNewFolderChat, onArchiveFolder, onArchiveSession, refresh]);

  // Keep the wrapper mounted so the collapse/expand animates with CSS grid
  // tracks. Effects above are still gated on `open`, so a collapsed sidebar
  // does no fetching while keeping the last-loaded list ready to animate.
  const expanded = open;
  const groupedProjects = groupSessionsByWorkspace(sessions, folders).projectGroups;
  const projectGroups = [...groupedProjects]
    .sort((a, b) => {
      const ai = folderOrder.indexOf(a.id);
      const bi = folderOrder.indexOf(b.id);
      return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) -
        (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
    })
    .map((group) => ({
      ...group,
      sessions: [...group.sessions].sort((a, b) => {
        const ai = sessionOrder.indexOf(a.id);
        const bi = sessionOrder.indexOf(b.id);
        return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) -
          (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
      }),
    }));

  const toggleProjectFolder = (path: string): void => {
    setClosedProjectFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      storeClosedFolders(next);
      return next;
    });
  };

  const renderSessionButton = (
    s: RecentSession,
    project = false,
    visible = expanded,
  ): React.JSX.Element => {
    const title = s.title || t("sessions.newConversation");
    const loading = resumingSessionId === s.id || loadingSessionIds.has(s.id);
    const active = !loading && currentSessionId === s.id;
    if (editingSessionId === s.id) {
      return (
        <form
          key={s.id}
          className="smartpuck-sidebar-inline-edit project-child"
          onSubmit={(event) => {
            event.preventDefault();
            const next = renameDraft.trim();
            if (!next) return;
            void onRenameSession(s.id, next).then(() => {
              setEditingSessionId(null);
              void refresh(true);
            });
          }}
        >
          <input
            autoFocus
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditingSessionId(null);
            }}
            aria-label="Chat name"
          />
          <button
            type="submit"
            title="Save chat name"
            aria-label="Save chat name"
          >
            <Check size={12} />
          </button>
          <button
            type="button"
            title="Cancel"
            aria-label="Cancel"
            onClick={() => setEditingSessionId(null)}
          >
            <X size={12} />
          </button>
        </form>
      );
    }
    return (
      <button
        key={s.id}
        type="button"
        draggable
        className={`sidebar-recent-session ${project ? "project-child" : ""} ${
          active ? "active" : ""
        }`}
        onClick={() => onSelect(s.id)}
        onDragStart={(event) => {
          setDraggedSessionId(s.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event) => {
          if (draggedSessionId && draggedSessionId !== s.id) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (!draggedSessionId || draggedSessionId === s.id) return;
          const next = moveBefore(
            sessionOrder,
            draggedSessionId,
            s.id,
            sessions.map((item) => item.id),
          );
          setSessionOrder(next);
          localStorage.setItem(`${SESSION_ORDER_KEY}.${activeProfile}`, JSON.stringify(next));
          setDraggedSessionId(null);
        }}
        onDragEnd={() => setDraggedSessionId(null)}
        onContextMenu={(event) => {
          if (editingSessionId === s.id) return;
          event.preventDefault();
          window.hermesAPI.smartPuck.showSessionContextMenu(s.id, title);
        }}
        title={title}
        tabIndex={visible ? 0 : -1}
      >
        {loading ? (
          <Loader
            className="sidebar-recent-session-dot sidebar-recent-session-dot--loading"
            size={11}
          />
        ) : (
          <Circle
            className={`sidebar-recent-session-dot ${
              active ? "sidebar-recent-session-dot--active" : ""
            }`}
            size={7}
            fill={active ? "currentColor" : "none"}
          />
        )}
        <span className="sidebar-recent-session-title">{title}</span>
        <span
          className="smartpuck-sidebar-row-edit"
          role="button"
          tabIndex={visible ? 0 : -1}
          title="Rename chat"
          aria-label="Rename chat"
          onClick={(event) => {
            event.stopPropagation();
            setEditingSessionId(s.id);
            setRenameDraft(title);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              setEditingSessionId(s.id);
              setRenameDraft(title);
            }
          }}
        >
          <Pencil size={11} />
        </span>
      </button>
    );
  };

  return (
    <div
      className={`sidebar-recent-sessions-wrap ${expanded ? "expanded" : ""}`}
      aria-hidden={!expanded}
    >
      <div className="sidebar-recent-sessions">
        {projectGroups.length > 0 ? (
          <div className="sidebar-recent-section">
            <div className="smartpuck-sidebar-section-heading">
              <span className="sidebar-recent-section-toggle">Folders</span>
              <button
                type="button"
                className="smartpuck-sidebar-folder-new"
                title="New meeting folder"
                aria-label="New meeting folder"
                onClick={() => {
                  setCreatingFolder(true);
                }}
              >
                <Plus size={13} />
              </button>
            </div>
            <div
              className={`sidebar-recent-collapse ${
                projectsOpen ? "expanded" : ""
              }`}
            >
              <div className="sidebar-recent-collapse-inner">
                {creatingFolder && (
                  <form
                    className="smartpuck-sidebar-inline-edit"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = folderDraft.trim();
                      if (name.length < 2) return;
                      void onCreateFolder(name).then(() => {
                        setFolderDraft("");
                        setCreatingFolder(false);
                      });
                    }}
                  >
                    <input
                      autoFocus
                      value={folderDraft}
                      onChange={(event) => setFolderDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setCreatingFolder(false);
                      }}
                      placeholder="Folder name"
                      aria-label="Folder name"
                    />
                    <button
                      type="submit"
                      title="Create folder"
                      aria-label="Create folder"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      type="button"
                      title="Cancel"
                      aria-label="Cancel"
                      onClick={() => setCreatingFolder(false)}
                    >
                      <X size={12} />
                    </button>
                  </form>
                )}
                {projectGroups.map((group) => {
                  const projectOpen = !closedProjectFolders.has(group.path);
                  const visible = expanded && projectsOpen && projectOpen;
                  return (
                    <div
                      className="sidebar-recent-project"
                      key={group.path}
                      draggable={editingFolderId !== group.id}
                      onDragStart={(event) => {
                        setDraggedFolderId(group.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(event) => {
                        if (draggedFolderId && draggedFolderId !== group.id) event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (!draggedFolderId || draggedFolderId === group.id) return;
                        const next = moveBefore(
                          folderOrder,
                          draggedFolderId,
                          group.id,
                          projectGroups.map((item) => item.id),
                        );
                        setFolderOrder(next);
                        localStorage.setItem(
                          `${FOLDER_ORDER_KEY}.${activeProfile}`,
                          JSON.stringify(next),
                        );
                        setDraggedFolderId(null);
                      }}
                      onDragEnd={() => setDraggedFolderId(null)}
                    >
                      <div
                        className="smartpuck-sidebar-folder-heading"
                        onContextMenu={(event) => {
                          if (editingFolderId === group.id) return;
                          event.preventDefault();
                          window.hermesAPI.smartPuck.showFolderContextMenu(
                            group.id,
                            group.name,
                            group.path,
                          );
                        }}
                      >
                        {editingFolderId === group.id ? (
                          <form
                            className="smartpuck-sidebar-inline-edit"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const name = renameDraft.trim();
                              if (name.length < 2) return;
                              void onRenameFolder(group.id, name).then(() =>
                                setEditingFolderId(null),
                              );
                            }}
                          >
                            <input
                              autoFocus
                              value={renameDraft}
                              onChange={(event) =>
                                setRenameDraft(event.target.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Escape")
                                  setEditingFolderId(null);
                              }}
                              aria-label="Folder name"
                            />
                            <button
                              type="submit"
                              title="Save folder name"
                              aria-label="Save folder name"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              type="button"
                              title="Cancel"
                              aria-label="Cancel"
                              onClick={() => setEditingFolderId(null)}
                            >
                              <X size={12} />
                            </button>
                          </form>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="sidebar-recent-project-heading"
                              title={group.path}
                              onClick={() => toggleProjectFolder(group.path)}
                              aria-expanded={projectOpen}
                              tabIndex={expanded && projectsOpen ? 0 : -1}
                            >
                              <Folder size={14} />
                              <span>{group.name}</span>
                              {projectOpen ? (
                                <ChevronDown
                                  className="sidebar-recent-disclosure-icon"
                                  size={12}
                                />
                              ) : (
                                <ChevronRight
                                  className="sidebar-recent-disclosure-icon"
                                  size={12}
                                />
                              )}
                            </button>
                            <button
                              type="button"
                              className="smartpuck-sidebar-folder-new"
                              title={`New chat in ${group.name}`}
                              aria-label={`New chat in ${group.name}`}
                              onClick={() =>
                                onNewFolderChat(group.path, group.name)
                              }
                              tabIndex={expanded && projectsOpen ? 0 : -1}
                            >
                              <Plus size={13} />
                            </button>
                          </>
                        )}
                      </div>
                      <div
                        className={`sidebar-recent-collapse ${
                          projectOpen ? "expanded" : ""
                        }`}
                      >
                        <div className="sidebar-recent-collapse-inner">
                          {group.sessions.length > 0 ? (
                            group.sessions.map((s) =>
                              renderSessionButton(s, true, visible),
                            )
                          ) : (
                            <button
                              type="button"
                              className="smartpuck-sidebar-empty-chat"
                              onClick={() =>
                                onNewFolderChat(group.path, group.name)
                              }
                              tabIndex={visible ? 0 : -1}
                            >
                              Start a chat
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="smartpuck-sidebar-no-folders">
            {creatingFolder ? (
              <form
                className="smartpuck-sidebar-inline-edit"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = folderDraft.trim();
                  if (name.length < 2) return;
                  void onCreateFolder(name).then(() => {
                    setFolderDraft("");
                    setCreatingFolder(false);
                  });
                }}
              >
                <input
                  autoFocus
                  value={folderDraft}
                  onChange={(event) => setFolderDraft(event.target.value)}
                  placeholder="Folder name"
                  aria-label="Folder name"
                />
                <button
                  type="submit"
                  title="Create folder"
                  aria-label="Create folder"
                >
                  <Check size={12} />
                </button>
                <button
                  type="button"
                  title="Cancel"
                  aria-label="Cancel"
                  onClick={() => setCreatingFolder(false)}
                >
                  <X size={12} />
                </button>
              </form>
            ) : (
              <>
                <span>No meeting folders yet</span>
                <button type="button" onClick={() => setCreatingFolder(true)}>
                  Create a folder
                </button>
              </>
            )}
          </div>
        )}
        {loadingMore && (
          <div className="sidebar-recent-loading" aria-live="polite">
            <Loader
              className="sidebar-recent-session-dot sidebar-recent-session-dot--loading"
              size={11}
            />
            <span>{t("common.loadingShort")}</span>
          </div>
        )}
      </div>
    </div>
  );
});

export default SidebarRecentSessions;
