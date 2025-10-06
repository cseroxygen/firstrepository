// Lazy-load expo-sqlite and use the classic WebSQL-style API for broad compatibility.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SQLite: typeof import('expo-sqlite') = require('expo-sqlite')
import { useMemo } from 'react'

const db = (SQLite as any).openDatabase('homeref.db')

function txExec(sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.transaction((tx: any) => {
      tx.executeSql(sql, params, () => resolve(), (_: any, err: any) => {
        reject(err); return true
      })
    })
  })
}

function txAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.transaction((tx: any) => {
      tx.executeSql(sql, params, (_: any, rs: any) => resolve(rs?.rows?._array ?? []), (_: any, err: any) => { reject(err); return true })
    })
  })
}

async function migrate() {
  await txExec(`CREATE TABLE IF NOT EXISTS appliances (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
  manual_id TEXT,
    updated_at INTEGER,
    deleted_at INTEGER,
    changed INTEGER DEFAULT 1
  );`)
  await txExec(`CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    appliance_id TEXT NOT NULL,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    mime TEXT,
    size INTEGER,
    sha256 TEXT,
    updated_at INTEGER,
    deleted_at INTEGER,
    changed INTEGER DEFAULT 1,
    FOREIGN KEY (appliance_id) REFERENCES appliances(id)
  );`)
  await txExec(`CREATE TABLE IF NOT EXISTS aliases (
    id TEXT PRIMARY KEY,
    appliance_id TEXT NOT NULL,
    alias TEXT NOT NULL,
    created_at INTEGER,
    FOREIGN KEY (appliance_id) REFERENCES appliances(id)
  );`)
  await txExec(`CREATE INDEX IF NOT EXISTS idx_alias_app ON aliases(appliance_id);`)

  // Ensure new columns exist for remote file management
  // Add files.s3_key to store uploaded key for deletes/previews
  try {
    const cols: any[] = await txAll<any>(`PRAGMA table_info(files)`)
    const hasS3 = cols.some((c:any)=> (c.name||c.cid) === 's3_key' || c.name === 's3_key')
    if (!hasS3) {
      await txExec(`ALTER TABLE files ADD COLUMN s3_key TEXT`)
    }
  } catch (_) {
    // best-effort; ignore if not supported
  }
  // Ensure appliances.manual_id exists
  try {
    const colsA: any[] = await txAll<any>(`PRAGMA table_info(appliances)`)
    const hasManual = colsA.some((c:any)=> (c.name||c.cid) === 'manual_id' || c.name === 'manual_id')
    if (!hasManual) {
      await txExec(`ALTER TABLE appliances ADD COLUMN manual_id TEXT`)
    }
  } catch (_) {}
}

migrate()

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0, v = c == 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

export function useDB() {
  return useMemo(() => ({
    async resetAll() {
      // Drop and recreate tables to clear local state
      await txExec(`DROP TABLE IF EXISTS aliases;`)
      await txExec(`DROP TABLE IF EXISTS files;`)
      await txExec(`DROP TABLE IF EXISTS appliances;`)
      await migrate()
    },
    async listAppliances(): Promise<{id:string; name:string; manual_id?: string}[]> {
      return await txAll<{id:string; name:string; manual_id?: string}>(`SELECT id, name, manual_id FROM appliances WHERE deleted_at IS NULL ORDER BY COALESCE(updated_at,0) DESC, name`)
    },
    async createAppliance(name: string, manualId?: string) {
      const id = uuid(); const now = Date.now()
      const mid = manualId || name
      await txExec(`INSERT INTO appliances (id,name,manual_id,updated_at,changed) VALUES (?,?,?,?,1)`, [id, name, mid, now])
      return id
    },
    async deleteAppliance(id: string) {
      const now = Date.now()
      await txExec(`UPDATE appliances SET deleted_at=?, changed=1 WHERE id=?`, [now, id])
      await txExec(`UPDATE files SET deleted_at=?, changed=1 WHERE appliance_id=?`, [now, id])
    },
    async renameAppliance(id: string, name: string) {
      const now = Date.now()
      await txExec(`UPDATE appliances SET name=?, updated_at=?, changed=1 WHERE id=?`, [name, now, id])
    },
    async getApplianceById(id: string) {
      const rows = await txAll<any>(`SELECT id, name, manual_id FROM appliances WHERE id=? LIMIT 1`, [id])
      return rows[0] || null
    },
    async getApplianceByName(name: string): Promise<{id:string}|null> {
      const rows = await txAll<any>(`SELECT id FROM appliances WHERE name=? AND deleted_at IS NULL LIMIT 1`, [name])
      return rows[0] || null
    },
    async getApplianceByManualId(manualId: string): Promise<{id:string}|null> {
      const rows = await txAll<any>(`SELECT id FROM appliances WHERE manual_id=? AND deleted_at IS NULL LIMIT 1`, [manualId])
      return rows[0] || null
    },
    async addFile(applianceId: string, f: { path:string; name:string; mime:string; size:number; sha256:string }) {
      const id = uuid(); const now = Date.now()
      await txExec(`INSERT INTO files (id, appliance_id, path, name, mime, size, sha256, updated_at, changed) VALUES (?,?,?,?,?,?,?,?,1)`, [id, applianceId, f.path, f.name, f.mime, f.size, f.sha256, now])
      return id
    },
    async getFileByS3Key(s3Key: string): Promise<{id:string}|null> {
      try { const rows = await txAll<any>(`SELECT id FROM files WHERE s3_key=? LIMIT 1`, [s3Key]); return rows[0] || null } catch { return null }
    },
    async addRemoteFile(applianceId: string, name: string, s3Key: string, size = 0, mime: string | null = null) {
      const exists = await (this as any).getFileByS3Key(s3Key)
      if (exists) return exists.id
      const id = uuid(); const now = Date.now()
      const path = `remote:${s3Key}`
      await txExec(`INSERT INTO files (id, appliance_id, path, name, mime, size, sha256, s3_key, updated_at, changed) VALUES (?,?,?,?,?,?,?, ?, ?, 0)`, [id, applianceId, path, name, mime, size, '', s3Key, now])
      return id
    },
    async setFileS3Key(id: string, key: string) {
      const now = Date.now()
      await txExec(`UPDATE files SET s3_key=?, updated_at=?, changed=1 WHERE id=?`, [key, now, id])
    },
    async deleteFile(id: string) {
      const now = Date.now()
      await txExec(`UPDATE files SET deleted_at=?, changed=1 WHERE id=?`, [now, id])
    },
    async listAppliancesWithFiles() {
      const apps = await txAll<any>(`SELECT id, name, manual_id FROM appliances WHERE deleted_at IS NULL ORDER BY name`)
      const results: any[] = []
      for (const a of apps) {
        const files = await txAll<any>(`SELECT * FROM files WHERE deleted_at IS NULL AND appliance_id=? ORDER BY COALESCE(updated_at,0) DESC`, [a.id])
        results.push({ appliance: a, files })
      }
      return results
    },
    async listAliases(applianceId: string) {
      await migrate()
      return txAll<any>(`SELECT * FROM aliases WHERE appliance_id=? ORDER BY alias COLLATE NOCASE`, [applianceId])
    },
    async addAlias(applianceId: string, alias: string) {
      await migrate()
      const id = uuid(); const now = Date.now()
      await txExec(`INSERT INTO aliases (id, appliance_id, alias, created_at) VALUES (?,?,?,?)`, [id, applianceId, alias.trim(), now])
      return id
    },
    async deleteAlias(id: string) {
      await migrate()
      await txExec(`DELETE FROM aliases WHERE id=?`, [id])
    },
    async getAliasesMap() {
      await migrate()
      const rows = await txAll<any>(`SELECT appliance_id, alias FROM aliases`)
      const map: Record<string,string[]> = {}
      for (const r of rows) {
        if (!map[r.appliance_id]) map[r.appliance_id] = []
        map[r.appliance_id].push(r.alias)
      }
      return map
    }
  }), [])
}

// Non-hook utility to wipe all local tables (used when switching users)
export async function wipeAllLocalData() {
  try {
    await txExec(`DROP TABLE IF EXISTS aliases;`)
    await txExec(`DROP TABLE IF EXISTS files;`)
    await txExec(`DROP TABLE IF EXISTS appliances;`)
  } catch (_) {}
  try { await migrate() } catch (_) {}
}
