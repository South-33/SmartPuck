import type Database from "better-sqlite3";
import { getDbConnection } from "./db";

const TABLE = "desktop_archived_items";

function ensureTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      item_id TEXT PRIMARY KEY,
      item_type TEXT NOT NULL, -- 'folder' or 'session'
      archived_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
    );
  `);
}

function tableExists(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(TABLE) as { name: string } | undefined;
  return !!row;
}

export function archiveItem(itemId: string, itemType: "folder" | "session"): void {
  const db = getDbConnection(false);
  if (!db) return;
  ensureTable(db);
  db.prepare(
    `INSERT OR REPLACE INTO ${TABLE} (item_id, item_type, archived_at)
     VALUES (?, ?, strftime('%s', 'now'))`
  ).run(itemId, itemType);
}

export function unarchiveItem(itemId: string): void {
  const db = getDbConnection(false);
  if (!db) return;
  ensureTable(db);
  db.prepare(`DELETE FROM ${TABLE} WHERE item_id = ?`).run(itemId);
}

export function getArchivedItems(): Array<{ itemId: string; itemType: string; title: string; archivedAt: number }> {
  const db = getDbConnection(true);
  if (!db || !tableExists(db)) return [];
  const rows = db.prepare(`SELECT item_id, item_type, archived_at FROM ${TABLE}`).all() as Array<{
    item_id: string;
    item_type: string;
    archived_at: number;
  }>;

  const result: Array<{ itemId: string; itemType: string; title: string; archivedAt: number }> = [];

  for (const r of rows) {
    let title = "Untitled";
    try {
      if (r.item_type === "folder") {
        const folderRow = db.prepare("SELECT name FROM smartpuck_folders WHERE id = ?").get(r.item_id) as { name: string } | undefined;
        title = folderRow?.name || "Folder";
      } else if (r.item_type === "session") {
        const sessionRow = db.prepare("SELECT title FROM sessions WHERE id = ?").get(r.item_id) as { title: string | null } | undefined;
        let titleVal = sessionRow?.title || "";
        if (!titleVal) {
          try {
            const msg = db
              .prepare(
                `SELECT content FROM messages
                 WHERE session_id = ? AND role = 'user' AND content IS NOT NULL
                 ORDER BY timestamp, id LIMIT 1`,
              )
              .get(r.item_id) as { content: string } | undefined;
            if (msg?.content) {
              const text = msg.content
                .trim()
                .replace(/[#*_`~[\]()]/g, "")
                .replace(/\s+/g, " ");
              titleVal = text.length > 50 ? text.slice(0, 50) + "..." : text;
            }
          } catch (e) {
            console.error("Failed to read first message for archived session title", e);
          }
        }
        title = titleVal || "Chat session";
      }
    } catch (err) {
      console.warn(`[archive] Failed to fetch title for item ${r.item_id}:`, err);
    }
    result.push({
      itemId: r.item_id,
      itemType: r.item_type,
      title,
      archivedAt: r.archived_at,
    });
  }

  return result;
}

export function isItemArchived(itemId: string): boolean {
  const db = getDbConnection(true);
  if (!db || !tableExists(db)) return false;
  const row = db
    .prepare(`SELECT item_id FROM ${TABLE} WHERE item_id = ?`)
    .get(itemId);
  return !!row;
}

export function getArchivedSessionIds(): Set<string> {
  const db = getDbConnection(true);
  if (!db || !tableExists(db)) return new Set();
  const rows = db.prepare(`SELECT item_id FROM ${TABLE} WHERE item_type = 'session'`).all() as Array<{
    item_id: string;
  }>;
  return new Set(rows.map(r => r.item_id));
}

export function getArchivedFolderIds(): Set<string> {
  const db = getDbConnection(true);
  if (!db || !tableExists(db)) return new Set();
  const rows = db.prepare(`SELECT item_id FROM ${TABLE} WHERE item_type = 'folder'`).all() as Array<{
    item_id: string;
  }>;
  return new Set(rows.map(r => r.item_id));
}
