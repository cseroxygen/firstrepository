import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { View, Text, TextInput, Button, StyleSheet, ScrollView, Pressable, Modal, Image, ActivityIndicator, Alert, Dimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useDB } from '@/lib/db'
import { api } from '@/lib/api'
import { addHistory } from '@/lib/history'
import { ensureNamespace } from '@/lib/ns'
import { getSession } from '@/lib/auth'
import { Picker } from '@react-native-picker/picker'
import * as Haptics from 'expo-haptics'
import * as WebBrowser from 'expo-web-browser'
import { i18n } from '@/lib/i18n'
import * as FileSystem from 'expo-file-system'
import { defaultApiBase } from '@/lib/config'
import { listen, EVENTS } from '@/lib/events'

export default function ChatScreen() {
  const SW = Dimensions.get('window').width
  const SH = Dimensions.get('window').height
  const SUGGESTION_KEYS = useMemo(() => [
    'chat.suggest.factoryReset',
    'chat.suggest.batteryFilter',
    'chat.suggest.connectWifi',
    'chat.suggest.scheduleService',
    'chat.suggest.troubleshootNoise',
    'chat.suggest.cleanSteps',
    'chat.suggest.softwareUpdate',
    'chat.suggest.energySave',
    'chat.suggest.cleanFilter',
    'chat.suggest.cleanDrum',
    'chat.suggest.updateFirmware',
    'chat.suggest.resetRouter',
    'chat.suggest.resetThermostat',
    'chat.suggest.pairRemote',
    'chat.suggest.calibrateSensor',
    'chat.suggest.childLock',
    'chat.suggest.cleanDustbin',
    'chat.suggest.replaceWaterFilter',
    'chat.suggest.cleanDisplay',
    'chat.suggest.updateApp',
    'chat.suggest.connectBluetooth',
    'chat.suggest.backupSettings',
    'chat.suggest.cleanCoffeeMachine',
    'chat.suggest.replaceVacuumBrush',
    'chat.suggest.calibrateTouchscreen',
    'chat.suggest.troubleshootNoPower',
    'chat.suggest.adjustBrightness',
    'chat.suggest.setTimer',
    'chat.suggest.enableEcoMode',
    'chat.suggest.interpretStatusLights',
    'chat.suggest.connectSmartHome',
    'chat.suggest.troubleshootCharging',
    'chat.suggest.updateMaps',
    'chat.suggest.cleanSteamIron',
    'chat.suggest.winterizeOutdoorUnit',
    'chat.suggest.sanitizeHumidifier',
    'chat.suggest.replaceInkCartridge',
    'chat.suggest.descaleDishwasher',
    'chat.suggest.locateSerialNumber',
    'chat.suggest.exportData',
    'chat.suggest.shareAccess',
    'chat.suggest.enableParentalControls',
  ] as const, [])
  const [lng, setLng] = useState(i18n.language)
  const db = useDB()
  const [appliances, setAppliances] = useState<{ id: string; name: string }[]>([])
  const [selected, setSelected] = useState<string>('ALL')
  // Start with an empty question by default
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [contexts, setContexts] = useState<any[]>([])
  const [lang, setLang] = useState<string>('auto')
  const [ns, setNs] = useState<string>('')
  const [apiBase, setApiBase] = useState<string>('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [tempSelection, setTempSelection] = useState<string>('ALL')
  const [guessed, setGuessed] = useState<string | undefined>(undefined)
  const [aliasesMap, setAliasesMap] = useState<Record<string,string[]>>({})
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewUris, setPreviewUris] = useState<string[]>([])
  const [previewPages, setPreviewPages] = useState<number[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewCaches, setPreviewCaches] = useState<string[]>([])
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewCtx, setPreviewCtx] = useState<{ key: string; page: number } | null>(null)
  const previewPagerRef = useRef<ScrollView | null>(null)
  const hasAutoCenteredRef = useRef(false)
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0)
  const previewCachesRef = useRef<string[]>([])
  const MAX_PREVIEW_PAGES = 8
  const [suggestions, setSuggestions] = useState<string[]>([])

  const refreshSuggestions = useCallback(() => {
    const pool = [...SUGGESTION_KEYS]
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = pool[i]
      pool[i] = pool[j]
      pool[j] = tmp
    }
    const picked = pool.slice(0, 3).map(key => String(i18n.t(key)))
    setSuggestions(picked)
  }, [SUGGESTION_KEYS, setSuggestions, lng])

  useFocusEffect(
    useCallback(() => {
      refreshSuggestions()
    }, [refreshSuggestions])
  )

  useEffect(() => {
    refreshSuggestions()
  }, [refreshSuggestions])

  useEffect(() => {
    previewCachesRef.current = previewCaches
  }, [previewCaches])

  // Centralized preview trigger so we can open the exact cited context page (instead of always contexts[0]).
  const triggerPreviewFromContext = useCallback(async (ctx: any) => {
  hasAutoCenteredRef.current = false
    if (!ctx) return
    try {
      // Resolve a file key and base page strictly from this context first
      let fileKey: string | undefined = ctx.s3_key
      // Keep cited page if present
      let basePage: number = Number(ctx.page || 1)
      if (!fileKey) {
        // Fallback: attempt to infer manual then pick first file (only if key missing)
        let manualName: string | undefined = undefined
        if (ctx.manual_id) manualName = ctx.manual_id
        else if (selected !== 'ALL') manualName = appliances.find(a=>a.id===selected)?.name
        else manualName = inferManualName(question)
        if (manualName) {
          try {
            const list = await api.listManualFiles(apiBase, manualName, ns)
            if (list.files && list.files.length) {
              fileKey = list.files[0]
              // Only reset to 1 if original context had no page (avoid mismatch)
              if (!ctx.page) basePage = 1
            }
          } catch {}
        }
      }
      if (!fileKey) { setPreviewError('No file available to preview.'); setPreviewOpen(true); return }
      setPreviewError(null)
      setPreviewCtx({ key: fileKey, page: basePage })
  const curPage: number = basePage
  const wantPages = Array.from(new Set([Math.max(1, curPage - 1), curPage, curPage + 1]))

      // Clean up any previous cached files
      if (previewCaches?.length) {
        for (const p of previewCaches) {
          try { await FileSystem.deleteAsync(p, { idempotent: true }) } catch {}
        }
      }

      setPreviewLoading(true); setPreviewOpen(true)

      const resultsUris: string[] = []
      const resultsPages: number[] = []

      const buildUrl = (pageNum: number, w = 2400, d = 320) => {
        const u = new URL(`${apiBase}/files/preview`)
        u.searchParams.set('key', fileKey as string)
        u.searchParams.set('page', String(pageNum))
        u.searchParams.set('width', String(w))
        u.searchParams.set('dpi', String(d))
        u.searchParams.set('bg', 'white')
        return u.toString()
      }

      const downloads = wantPages.map(async (pnum) => {
        const target = FileSystem.cacheDirectory + `manual_preview_p${pnum}_${Date.now()}.png`
        try {
        const res = await FileSystem.downloadAsync(buildUrl(pnum, 2400, 320), target)
          // @ts-ignore
          if (res?.status && res.status !== 200) throw new Error(`HTTP ${res.status}`)
          if (res?.uri) {
            resultsUris.push(res.uri)
            resultsPages.push(pnum)
          }
        } catch (e) {
          console.warn('Preview download fallback', pnum, e)
          try {
            const target2 = FileSystem.cacheDirectory + `manual_preview_p${pnum}_b_${Date.now()}.png`
            const res2 = await FileSystem.downloadAsync(buildUrl(pnum, 1800, 260), target2)
            // @ts-ignore
            if (res2?.status && res2.status !== 200) throw new Error(`HTTP ${res2.status}`)
            if (res2?.uri) {
              resultsUris.push(res2.uri)
              resultsPages.push(pnum)
            }
          } catch {}
        }
      })

      await Promise.allSettled(downloads)

      if (resultsUris.length === 0) {
        console.warn('Preview defaulted to remote URIs (no local cache).')
        const remoteUris = wantPages.map((pnum) => buildUrl(pnum, 1200, 180))
        if (remoteUris.length > 0) {
          setPreviewCaches([])
          setPreviewUris(remoteUris)
          setPreviewPages(wantPages)
        } else {
          setPreviewError('No previews available. Try opening the full manual instead.')
        }
      } else {
  const pairs = resultsUris.map((u, i) => ({ u, p: resultsPages[i] }))
  pairs.sort((a,b)=> (a.p||0) - (b.p||0))
  // Determine index of current page before setting
  const baseIdx = pairs.findIndex(pp => pp.p === curPage)
  setPreviewInitialIndex(baseIdx >= 0 ? baseIdx : 0)
  setPreviewCaches(pairs.map(x=>x.u))
  setPreviewUris(pairs.map(x=>x.u))
  setPreviewPages(pairs.map(x=>x.p))
      }
    } catch(e:any) {
      setPreviewError(e?.message || String(e))
    } finally {
      setPreviewLoading(false)
    }
  }, [appliances, apiBase, ns, question, previewCaches, selected])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      await getSession()
      if (!mounted) return
      setNs(await ensureNamespace())
      try { setAppliances(await db.listAppliances()) } catch {}
      const fallbackBase = defaultApiBase()
      setApiBase((await AsyncStorage.getItem('api_base')) || fallbackBase)
      // If returning user has remote manuals but local DB empty (due to wipe on user switch), sync basic appliance names.
      try {
        const current = await db.listAppliances()
        if (current.length === 0) {
          const fallbackBase = defaultApiBase()
          const base = (await AsyncStorage.getItem('api_base')) || fallbackBase
          const nsVal = await AsyncStorage.getItem('namespace') || ''
      const remote = await api.listManuals(base, nsVal)
      const mapRaw = await AsyncStorage.getItem(`rename_map:${nsVal}`)
      const renameMap: Record<string,string> = mapRaw ? JSON.parse(mapRaw) : {}
          if (remote.manual_ids?.length) {
      for (const mid of remote.manual_ids) {
              try {
        const desiredName = renameMap[mid] || mid
        const existing = await db.getApplianceByManualId(mid) || await db.getApplianceByName(desiredName)
        const appId = existing?.id || await db.createAppliance(desiredName, mid)
                const files = await api.listManualFiles(base, mid, nsVal)
                for (const key of files.files || []) {
                  const parts = key.split('/')
                  const fname = parts[parts.length - 1] || 'file'
                  await db.addRemoteFile(appId, fname, key)
                }
              } catch {}
            }
            if (mounted) setAppliances(await db.listAppliances())
          }
        }
      } catch {}
    })()
    return () => { mounted = false }
  }, [])

  useFocusEffect(React.useCallback(() => {
    let active = true
    ;(async () => {
      try { const cur = await ensureNamespace(); if (active) setNs(cur) } catch {}
    })()
    return () => { active = false }
  }, []))

  // Re-render on language change
  useEffect(() => {
    const handler = (l: string) => setLng(l)
    // @ts-ignore
    i18n.on && i18n.on('languageChanged', handler)
    return () => { /* @ts-ignore */ i18n.off && i18n.off('languageChanged', handler) }
  }, [])

  // Refresh appliances list whenever this tab gains focus (e.g., after uploads in Library)
  useFocusEffect(
    useCallback(() => {
      let mounted = true
      ;(async () => {
        try {
          const list = await db.listAppliances()
          if (mounted) setAppliances(list)
          const map = await db.getAliasesMap?.()
          if (mounted && map) setAliasesMap(map)
        } catch {}
      })()
      return () => { mounted = false }
    }, [db])
  )

  useEffect(() => {
    const unsubscribe = listen(EVENTS.dataCleared, async () => {
      hasAutoCenteredRef.current = false
      const previousCaches = previewCachesRef.current
      if (previousCaches.length) {
        for (const path of previousCaches) {
          try { await FileSystem.deleteAsync(path, { idempotent: true }) } catch {}
        }
      }
      setAppliances([])
      setAliasesMap({})
      setSelected('ALL')
      setTempSelection('ALL')
      setPickerOpen(false)
      setGuessed(undefined)
      setQuestion('')
      setAnswer('')
      setContexts([])
      setPreviewOpen(false)
      setPreviewUris([])
      setPreviewPages([])
      setPreviewLoading(false)
      setPreviewError(null)
      setPreviewCtx(null)
      setPreviewCaches([])
      setPreviewInitialIndex(0)
      setLang('auto')
      const fallbackBase = defaultApiBase()
      const base = (await AsyncStorage.getItem('api_base')) || fallbackBase
      setApiBase(base)
      const nsVal = await ensureNamespace()
      setNs(nsVal)
      refreshSuggestions()
    })
    return unsubscribe
  }, [refreshSuggestions])

  const manualId = selected === 'ALL' ? undefined : selected

  function selectedName() {
    return selected === 'ALL' ? 'All' : (appliances.find(a=>a.id===selected)?.name || 'All')
  }

  const submitQuestion = async () => {
    if (!question.trim()) return
    setAnswer('')
    setContexts([])
    try {
      const langFilter = lang==='auto'? undefined: lang
      // Determine manual name passed to API (server expects appliance name, not local id)
      let manualName: string | undefined = manualId ? (appliances.find(a=>a.id===manualId)?.name) : undefined
      if (!manualName) {
        manualName = inferManualName(question)
      }
      let q = await api.query(apiBase, question, manualName, 5, langFilter, ns)
      // Fallback: if little context and we inferred, broaden search
      if ((q.contexts?.length||0) < 2 && manualName) {
        const qAll = await api.query(apiBase, question, undefined, 5, langFilter, ns)
        const seen = new Set<string>()
        const merged: any[] = []
        for (const c of [...(q.contexts||[]), ...(qAll.contexts||[])]) {
          const k = `${c.s3_key}:${c.chunk_index}`
          if (!seen.has(k)) { seen.add(k); merged.push(c) }
        }
        q.contexts = merged.slice(0,5)
      }
      setContexts(q.contexts || [])
      const c = await api.chat(apiBase, question, manualName, langFilter, ns)
      setAnswer(c.answer || '')
      // history
      try { await addHistory({ type:'query', title: question, meta: { manual: manualName || 'ALL' } }) } catch {}
    } catch (e:any) {
      setAnswer(`Error: ${e.message || String(e)}`)
    }
  }

  // Broad brand/category aliases to help inference. Keys are canonical terms we expect in
  // appliance names; values are synonyms that may appear in a user's question.
  const ALIASES: Record<string, string[]> = {
    'nespresso': ['nespresso','espresso','coffee machine','coffee maker'],
    'playstation 5': ['ps5','playstation 5','play station','ps-5','ps 5'],
    'dyson': ['dyson','vacuum','vacuum cleaner'],
    'refrigerator': ['fridge','refrigerator','freezer'],
    'television': ['tv','television','smart tv'],
    'monitor': ['monitor','display'],
    'mouse': ['mouse','mice'],
    'keyboard': ['keyboard'],
    'router': ['router','wi-fi','wifi','modem'],
    'iphone': ['iphone','phone'],
    'ipad': ['ipad','tablet'],
    'macbook': ['macbook','laptop','notebook'],
  }

  function inferManualName(q: string): string | undefined {
    const norm = (s:string)=> s.toLowerCase().replace(/[^a-z0-9\s]/g,' ')
    const qs = norm(q)
    let best: {name:string, score:number} | null = null
    for (const a of appliances) {
      const an = norm(a.name)
      const tokens = an.split(/\s+/).filter(Boolean)
      let score = 0
      for (const t of tokens) {
        if (t.length>=2 && qs.includes(t)) score+=2
        const nv = t.replace(/[aeiou]/g,'')
        if (nv.length>=2 && qs.replace(/[aeiou]/g,'').includes(nv)) score+=1
      }
      // static alias boost when canonical appears in the appliance name
      for (const [canon, syns] of Object.entries(ALIASES)) {
        if (an.includes(canon)) {
          for (const syn of syns) if (qs.includes(syn)) score += 3
        }
      }
      // user-defined aliases for this appliance
      const appAliases = aliasesMap[a.id] || []
      for (const al of appAliases) {
        const aln = norm(al)
        if (aln && qs.includes(aln)) score += 3
      }
      if (score>0 && (!best || score>best.score)) best = { name: a.name, score }
    }
    return best?.name
  }
  function openAppliancePicker() {
    setTempSelection(selected)
    setPickerOpen(true)
    Haptics.selectionAsync()
  }

  useEffect(()=>{
    if (selected === 'ALL') setGuessed(inferManualName(question))
    else setGuessed(undefined)
  }, [selected, question, appliances])

  // Cleanup cached preview files when modal closes
  useEffect(() => {
    if (!previewOpen && previewCaches.length) {
      (async () => {
        for (const p of previewCaches) {
          try { await FileSystem.deleteAsync(p, { idempotent: true }) } catch {}
        }
      })()
      setPreviewCaches([])
      setPreviewUris([])
      setPreviewPages([])
    }
  }, [previewOpen])

  // When previews ready, jump horizontally so the cited page is centered (prev on left, next on right)
  // Remove old auto-centering logic; we now use contentOffset with previewInitialIndex

  // Dynamically load next/prev pages when user swipes to an edge page in cache
  const ensurePageLoaded = useCallback(async (pageNum: number) => {
    if (!previewCtx || !previewCtx.key) return
    if (previewPages.includes(pageNum)) return
    if (pageNum < 1) return
    try {
      const buildUrl = (p:number, w=2200, d=300) => {
        const u = new URL(`${apiBase}/files/preview`)
        u.searchParams.set('key', previewCtx.key)
        u.searchParams.set('page', String(p))
        u.searchParams.set('width', String(w))
        u.searchParams.set('dpi', String(d))
        u.searchParams.set('bg','white')
        return u.toString()
      }
      const target = FileSystem.cacheDirectory + `manual_preview_dyn_p${pageNum}_${Date.now()}.png`
      let okUri: string | null = null
      try {
        const res = await FileSystem.downloadAsync(buildUrl(pageNum, 2200, 300), target)
        // @ts-ignore
        if (!res?.status || res.status === 200) okUri = res.uri
      } catch {
        try {
          const res2 = await FileSystem.downloadAsync(buildUrl(pageNum, 1600, 240), target+"_b")
          // @ts-ignore
          if (!res2?.status || res2.status === 200) okUri = res2.uri
        } catch {}
      }
      if (!okUri) return
      // Insert maintaining sort order
      const npages = [...previewPages, pageNum]
      const nuris = [...previewUris, okUri]
      const pair = npages.map((p,i)=>({p, u: nuris[i]}))
      pair.sort((a,b)=>a.p-b.p)
      // LRU eviction (trim from whichever side exceeds window)
      if (pair.length > MAX_PREVIEW_PAGES) {
        const excess = pair.length - MAX_PREVIEW_PAGES
        for (let i=0;i<excess;i++) {
          // Prefer removing farthest from current context page
          const cur = previewCtx.page
            // find farthest index
          let farIdx = 0; let farDist = -1
          pair.forEach((it, idx)=>{ const d=Math.abs(it.p-cur); if(d>farDist){ farDist=d; farIdx=idx } })
          const removed = pair.splice(farIdx,1)[0]
          try { await FileSystem.deleteAsync(removed.u, { idempotent:true }) } catch {}
        }
      }
      setPreviewPages(pair.map(x=>x.p))
      setPreviewUris(pair.map(x=>x.u))
    } catch {}
  }, [previewCtx, previewPages, previewUris, apiBase])

  const onPreviewScrollEnd = useCallback(async (ev:any) => {
    if (!previewCtx) return
    const pageWidth = SW
    const offsetX = ev.nativeEvent.contentOffset.x || 0
    const idx = Math.round(offsetX / pageWidth)
  const viewedPage = previewPages[idx]
    if (!viewedPage) return
    // Preload neighbors
    await ensurePageLoaded(viewedPage - 1)
    await ensurePageLoaded(viewedPage + 1)
  }, [SW, previewCtx, previewPages, ensurePageLoaded])

  return (
    <>
    <ScrollView style={{ flex: 1, padding: 16 }} contentInsetAdjustmentBehavior="automatic">
      {/* Large title is provided by the navigation header */}
      <Text style={s.label}>{String(i18n.t('chat.chooseProduct'))}</Text>
      <Pressable onPress={openAppliancePicker} style={s.dropdown} accessibilityRole="button">
        <Text style={{ fontSize: 17 }}>{selectedName()}</Text>
        <Ionicons name="chevron-down" size={18} color="#6b7c90" />
      </Pressable>

      {selected==='ALL' && !!guessed && (
        <Text style={{ color:'#6b7c90', fontSize:13, marginTop:4 }}>Guessed: {guessed}</Text>
      )}


      <Text style={s.label}>{i18n.t('chat.question')}</Text>
      <View style={s.composerWrapper}>
        <TextInput
          value={question}
          onChangeText={setQuestion}
          placeholder={i18n.t('chat.placeholderQuestion') as string}
          style={[s.input, { paddingRight: 56 }]}
          multiline
          returnKeyType="send"
          onSubmitEditing={() => { if (question.trim()) submitQuestion() }}
          blurOnSubmit={false}
        />
        <Pressable
          onPress={() => submitQuestion()}
          disabled={!question.trim()}
          accessibilityRole="button"
          style={[s.sendButton, !question.trim() && s.sendButtonDisabled]}
        >
          <Ionicons name="send" size={20} color="#fff" />
        </Pressable>
      </View>
      <View style={s.suggestionsRow}>
        {suggestions.map((t, idx) => (
          <Pressable key={idx} onPress={() => setQuestion(String(t))} style={s.suggestionChip} accessibilityRole="button">
            <Text style={s.suggestionText}>{String(t)}</Text>
          </Pressable>
        ))}
      </View>
      {selected==='ALL' && !!guessed && (
        <View style={{ marginTop:8 }}>
          <Pressable onPress={()=>{ const a=appliances.find(x=>x.name.toLowerCase()===guessed!.toLowerCase()); if(a){ setSelected(a.id); Haptics.selectionAsync(); } }} style={{ paddingVertical:8, paddingHorizontal:12, borderRadius:12, borderColor:'#E5E7EB', borderWidth:1, alignSelf:'flex-start' }}>
            <Text style={{ color:'#0A84FF' }}>Use: {guessed}</Text>
          </Pressable>
        </View>
      )}

      {!!answer && (
        <View style={s.card}>
          <Text style={s.answer}>{answer}</Text>
          <View style={s.actionsRow}>
            <Pressable
              accessibilityRole="button"
              style={s.primaryPill}
              onPress={async ()=>{
                try {
                  const ctx = contexts[0]
                  if (!ctx?.s3_key) return
                  const url = await api.fileUrl(apiBase, ctx.s3_key)
                  await WebBrowser.openBrowserAsync(url)
                } catch(e) {}
              }}
            >
              <Text style={s.primaryPillText}>{String(i18n.t('chat.openManual'))}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={s.ghostPill} onPress={()=>{ if(contexts[0]) triggerPreviewFromContext(contexts[0]) }}>
              <Text style={s.ghostPillText}>{String(i18n.t('chat.previewPage'))}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {!!contexts.length && (
        <View style={s.card}>
          <Text style={s.label}>Context</Text>
          {contexts.map((c, i) => (
            <View key={i} style={s.ctx}>
              <Text style={s.ctxTitle}>{c.manual_id} — page {c.page}, chunk {c.chunk_index}{c.lang?`, lang ${c.lang}`:''}</Text>
              <Text style={s.ctxText}>{(c.text||'').slice(0, 400)}{(c.text||'').length>400?'…':''}</Text>
              <View style={{ flexDirection:'row', gap:8, marginTop:6 }}>
                <Pressable accessibilityRole='button' style={s.ghostPill} onPress={()=> triggerPreviewFromContext(c)}>
                  <Text style={s.ghostPillText}>Preview p{c.page}</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={()=>setPickerOpen(false)}>
        <View style={s.sheetOverlay}>
          <Pressable style={{ flex:1 }} onPress={()=>setPickerOpen(false)} />
          <View style={s.sheet}>
            <View style={s.sheetHeader}>
              <Pressable onPress={()=>setPickerOpen(false)}><Text style={s.sheetBtn}>Cancel</Text></Pressable>
              <Text style={s.sheetTitle}>{String(i18n.t('chat.chooseProduct'))}</Text>
              <Pressable onPress={()=>{ setSelected(tempSelection); setPickerOpen(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium) }}><Text style={[s.sheetBtn,{fontWeight:'700'}]}>Done</Text></Pressable>
            </View>
            <Picker selectedValue={tempSelection} onValueChange={(v)=>setTempSelection(v)} itemStyle={{ fontSize: 20 }}>
              <Picker.Item label="All" value="ALL" />
              {appliances.map(a=> (<Picker.Item key={a.id} label={a.name} value={a.id} />))}
            </Picker>
          </View>
        </View>
      </Modal>
    </ScrollView>
    <Modal visible={previewOpen} transparent animationType='fade' onRequestClose={()=>setPreviewOpen(false)}>
      <View style={s.previewOverlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close preview" onPress={()=>setPreviewOpen(false)} style={s.closeBtn}>
          <Ionicons name="close" size={24} color="#fff" />
        </Pressable>
        {previewLoading ? (
          <ActivityIndicator size="large" color="#fff" />
        ) : (
          previewUris.length > 0 ? (
            <ScrollView
              ref={previewPagerRef}
              horizontal
              pagingEnabled
              style={[s.previewPager, { width: SW, height: SH }]}
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onPreviewScrollEnd}
              // Start at the cited page index
              contentOffset={{ x: previewInitialIndex * SW, y: 0 }}
            >
              {previewUris.map((uri, idx) => (
                <View key={idx} style={[s.previewPage, { width: SW, height: SH }] }>
                  <ScrollView
                    style={[s.previewZoom, { width: SW, height: SH }]}
                    contentContainerStyle={[s.previewZoomContent, { minWidth: SW, minHeight: SH }]}
                    maximumZoomScale={4}
                    minimumZoomScale={1}
                    bounces={false}
                    centerContent
                    showsHorizontalScrollIndicator={false}
                    showsVerticalScrollIndicator={false}
                    directionalLockEnabled
                  >
                    <Image
                      source={{ uri }}
                      style={[s.previewImage, { width: SW * 0.88, height: SH * 0.7 }]}
                      onError={() => {
                        // If remote image fails to load, show fallback UI
                        setPreviewError('Failed to load preview image. Try Open manual.')
                        setPreviewUris([])
                      }}
                    />
                  </ScrollView>
                  {!!previewPages[idx] && (
                    <View style={s.pageBadge}><Text style={s.pageBadgeText}>{previewPages[idx]}</Text></View>
                  )}
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={s.previewFallback}>
              <Text style={s.previewFallbackText}>{previewError || 'Preview unavailable.'}</Text>
              {previewCtx && (
                <Pressable style={s.primaryPill} onPress={async ()=>{
                  try {
                    const url = await api.fileUrl(apiBase, previewCtx.key)
                    await WebBrowser.openBrowserAsync(url)
                  } catch (e) {}
                }}>
                  <Text style={s.primaryPillText}>{String(i18n.t('chat.openManual'))}</Text>
                </Pressable>
              )}
            </View>
          )
        )}
      </View>
    </Modal>
    </>
  )
}

const s = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '600', marginBottom: 12 },
  label: { color: '#6b7c90', marginTop: 8, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#223244', padding: 10, borderRadius: 8, minHeight: 80 },
  selectRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  dropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12 },
  card: { borderWidth: 1, borderColor: '#223244', borderRadius: 10, padding: 12, marginTop: 8 },
  answer: { fontSize: 16 },
  ctx: { borderTopWidth: 1, borderTopColor: '#223244', paddingTop: 8, marginTop: 8 },
  ctxTitle: { fontWeight: '600' },
  ctxText: { color: '#9fb2c7' },
  sheetOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.2)', justifyContent:'flex-end' },
  sheet: { backgroundColor:'#fff', borderTopLeftRadius:16, borderTopRightRadius:16, paddingBottom: 24 },
  sheetHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:16, paddingTop:12 },
  sheetBtn: { color:'#0A84FF', fontSize:17, padding:8 },
  sheetTitle: { fontSize:17, fontWeight:'600' },
  // Additional styles for suggestion buttons and composer
  composerWrapper: { position:'relative' },
  suggestionsRow: { flexDirection:'row', flexWrap:'wrap', gap:8, marginTop:8 },
  suggestionChip: { paddingVertical:8, paddingHorizontal:12, borderRadius:12, borderColor:'#E5E7EB', borderWidth:1, backgroundColor:'#F8FAFC' },
  suggestionText: { color:'#0A84FF' },
  sendButton: { position:'absolute', right:8, bottom:8, width:44, height:44, borderRadius:22, backgroundColor:'#0A84FF', alignItems:'center', justifyContent:'center', shadowColor:'#000', shadowOpacity:0.15, shadowRadius:6, shadowOffset:{ width:0, height:3 } },
  sendButtonDisabled: { backgroundColor:'#A7B2C0' },
  actionsRow: { flexDirection:'row', gap:12, marginTop:8, flexWrap:'wrap' },
  primaryPill: { backgroundColor:'#0A84FF', borderRadius:18, paddingVertical:10, paddingHorizontal:16, shadowColor:'#000', shadowOpacity:0.12, shadowRadius:6, shadowOffset:{ width:0, height:3 }, elevation:2 },
  primaryPillText: { color:'#fff', fontSize:16, fontWeight:'700' },
  ghostPill: { backgroundColor:'#fff', borderRadius:18, paddingVertical:10, paddingHorizontal:16, borderWidth:1, borderColor:'#D1D5DB' },
  ghostPillText: { color:'#111827', fontSize:16, fontWeight:'600' },
  // Preview modal styles with pinch-to-zoom
  previewOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.9)', justifyContent:'center', alignItems:'center' },
  closeBtn: { position:'absolute', top: 48, right: 24, zIndex: 2, backgroundColor:'rgba(0,0,0,0.5)', padding:8, borderRadius:16 },
  previewZoom: { width: undefined, height: undefined },
  previewZoomContent: { minWidth: 0, minHeight: 0, justifyContent:'center', alignItems:'center' },
  previewImage: { resizeMode:'contain', backgroundColor:'#000' },
  // Pager for prev/current/next previews
  previewPager: { },
  previewPage: { justifyContent:'center', alignItems:'center' },
  pageBadge: { position:'absolute', bottom: 28, right: 28, backgroundColor:'rgba(0,0,0,0.6)', paddingHorizontal:10, paddingVertical:6, borderRadius:14 },
  pageBadgeText: { color:'#fff', fontWeight:'700' },
  previewFallback: { alignItems:'center', justifyContent:'center', gap:12 },
  previewFallbackText: { color:'#fff', marginBottom:4 },
})
