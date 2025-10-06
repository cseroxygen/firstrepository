// Lightweight history helpers (separate from main DB)
// Uses WebSQL-style API from expo-sqlite, lazily required
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SQLite: typeof import('expo-sqlite') = require('expo-sqlite')

const db = (SQLite as any).openDatabase('homeref.db')

function txExec(sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.transaction((tx: any) => {
      tx.executeSql(sql, params, () => resolve(), (_: any, err: any) => { reject(err); return true })
    })
  })
}

function txAll<T=any>(sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.transaction((tx: any) => {
      tx.executeSql(sql, params, (_: any, rs: any) => resolve(rs?.rows?._array ?? []), (_: any, err: any) => { reject(err); return true })
    })
  })
}

async function ensure() {
  await txExec(`CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY,
    type TEXT,
    title TEXT,
    meta TEXT,
    created_at INTEGER
  );`)
  await txExec(`CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC);`)
}

function uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{const r=(Math.random()*16)|0, v=c==='x'?r:(r&0x3|0x8);return v.toString(16)}) }

export async function addHistory(e: { id?: string, type:'query'|'upload'|'index', title:string, meta?: any, created_at?: number }) {
  await ensure()
  const id = e.id || uuid()
  const ts = e.created_at || Date.now()
  await txExec(`INSERT OR REPLACE INTO history (id,type,title,meta,created_at) VALUES (?,?,?,?,?)`, [id, e.type, e.title, JSON.stringify(e.meta||{}), ts])
  return id
}

export async function getHistory(limit=100, type?: 'query'|'upload'|'index') {
  await ensure()
  if (type) return txAll(`SELECT * FROM history WHERE type=? ORDER BY created_at DESC LIMIT ?`, [type, limit])
  return txAll(`SELECT * FROM history ORDER BY created_at DESC LIMIT ?`, [limit])
}

export async function clearHistory() {
  await ensure(); await txExec(`DELETE FROM history`)
}

export async function deleteHistory(id: string) {
  await ensure(); await txExec(`DELETE FROM history WHERE id=?`, [id])
}

