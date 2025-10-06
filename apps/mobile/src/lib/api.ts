export const api = {
  async query(base: string, question: string, manualId?: string, topK = 5, lang?: string, namespace?: string) {
    const r = await fetch(`${base}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, manual_id: manualId, top_k: topK, lang, namespace }) })
    if (!r.ok) throw new Error(`Query failed ${r.status}`)
    return r.json()
  },
  async chat(base: string, question: string, manualId?: string, lang?: string, namespace?: string) {
    const r = await fetch(`${base}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, manual_id: manualId, lang, namespace }) })
    if (!r.ok) throw new Error(`Chat failed ${r.status}`)
    return r.json()
  },
  async upload(base: string, manualId: string, f: { path: string; name: string; mime: string; size: number }, namespace?: string) {
    const fd = new FormData()
    fd.append('manual_id', manualId)
    if (namespace) fd.append('namespace', namespace)
    // @ts-ignore
    fd.append('file', { uri: f.path, name: f.name, type: f.mime })
    const r = await fetch(`${base}/upload`, { method: 'POST', body: fd })
    if (!r.ok) throw new Error(`Upload failed ${r.status}`)
    return r.json()
  },
  async ingest(base: string, bucket: string, key: string, manualId: string, contentType: string, namespace?: string) {
    const r = await fetch(`${base}/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bucket, key, manual_id: manualId, content_type: contentType, namespace }) })
    if (!r.ok) throw new Error(`Ingest failed ${r.status}`)
    return r.json()
  },
  async ingestStart(base: string, bucket: string, key: string, manualId: string, contentType: string, namespace?: string) {
    const r = await fetch(`${base}/ingest/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bucket, key, manual_id: manualId, content_type: contentType, namespace }) })
    if (!r.ok) throw new Error(`Ingest start failed ${r.status}`)
    return r.json()
  },
  async ingestStatus(base: string, jobId: string) {
    const u = new URL(`${base}/ingest/status`)
    u.searchParams.set('job_id', jobId)
    const r = await fetch(u.toString())
    if (!r.ok) throw new Error(`Ingest status failed ${r.status}`)
    return r.json()
  },

  async fileUrl(base: string, key: string): Promise<string> {
    const u = new URL(`${base}/files/url`)
    u.searchParams.set('key', key)
    const r = await fetch(u.toString())
    if (!r.ok) throw new Error(`file url failed ${r.status}`)
    const j = await r.json()
    return j.url as string
  },
  async listManualFiles(base: string, manualId: string, namespace?: string) {
    const u = new URL(`${base}/manuals/${encodeURIComponent(manualId)}/files`)
    if (namespace) u.searchParams.set('namespace', namespace)
    const r = await fetch(u.toString())
    if (!r.ok) throw new Error(`List files failed ${r.status}`)
    return r.json() as Promise<{ manual_id: string; files: string[] }>
  },
  async listManuals(base: string, namespace?: string) {
    const u = new URL(`${base}/manuals`)
    if (namespace) u.searchParams.set('namespace', namespace)
    const r = await fetch(u.toString())
    if (!r.ok) throw new Error(`List manuals failed ${r.status}`)
    return r.json() as Promise<{ manual_ids: string[] }>
  },
  // Fetch a quick preview-ready key for a manual (first file) without full DB state
  async firstManualFileKey(base: string, manualId: string, namespace?: string) {
    const list = await this.listManualFiles(base, manualId, namespace)
    return list.files?.[0]
  },
  async deleteFile(base: string, manualId: string, key: string, namespace?: string) {
    const u = new URL(`${base}/manuals/${encodeURIComponent(manualId)}/files`)
    u.searchParams.set('key', key)
    if (namespace) u.searchParams.set('namespace', namespace)
    const r = await fetch(u.toString(), { method: 'DELETE' })
    if (!r.ok) throw new Error(`Delete file failed ${r.status}`)
    return r.json()
  },
  async deleteManual(base: string, manualId: string, namespace?: string) {
    const u = new URL(`${base}/manuals/${encodeURIComponent(manualId)}`)
    if (namespace) u.searchParams.set('namespace', namespace)
    const r = await fetch(u.toString(), { method: 'DELETE' })
    if (!r.ok) throw new Error(`Delete manual failed ${r.status}`)
    return r.json()
  }
}
