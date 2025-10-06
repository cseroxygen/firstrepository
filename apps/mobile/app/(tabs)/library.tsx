import { useEffect, useState, useCallback } from 'react'
import { View, Text, TextInput, Button, StyleSheet, ScrollView, Alert, Modal, Pressable, ActivityIndicator, ActionSheetIOS, Platform } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { useDB } from '@/lib/db'
import { i18n } from '@/lib/i18n'
import { fs } from '@/lib/fs'
import { addHistory } from '@/lib/history'
import * as Haptics from 'expo-haptics'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { api } from '@/lib/api'
import { ensureNamespace } from '@/lib/ns'
import { getSession } from '@/lib/auth'
import { useFocusEffect } from '@react-navigation/native'
import { listen, EVENTS } from '@/lib/events'
import { defaultApiBase } from '@/lib/config'

export default function LibraryScreen() {
  const db = useDB()
  // Re-render on language change so labels update
  const [lng, setLng] = useState(i18n.language)
  const [name, setName] = useState('')
  const [list, setList] = useState<any[]>([])
  const [apiBase, setApiBase] = useState('')
  const [aliasForApp, setAliasForApp] = useState<string | null>(null)
  const [aliases, setAliases] = useState<any[]>([])
  const [newAlias, setNewAlias] = useState('')
  const [ns, setNs] = useState('')
  const [busyJob, setBusyJob] = useState<string | null>(null)
  const [renamingForApp, setRenamingForApp] = useState<string | null>(null)
  const [menuForApp, setMenuForApp] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [workingFor, setWorkingFor] = useState<string | null>(null)
  const [loadingMsg, setLoadingMsg] = useState<string | null>(null)

  type PreparedAsset = { uri: string; name: string; mime: string }

  const refresh = useCallback(async () => {
    setList(await db.listAppliancesWithFiles())
  }, [db])

  const prepareImageAsset = useCallback(async (asset: ImagePicker.ImagePickerAsset): Promise<PreparedAsset> => {
    const originalName = asset.fileName || `photo_${Date.now()}`
    const lowerName = originalName.toLowerCase()
    let mime = asset.mimeType || (lowerName.endsWith('.png') ? 'image/png' : 'image/jpeg')
    let extension = lowerName.includes('.') ? lowerName.split('.').pop() || '' : ''
    let uri = asset.uri

    // Convert HEIC/unsupported formats to JPEG for reliable OCR
    if (mime === 'image/heic' || mime === 'image/heif' || extension === 'heic' || extension === 'heif') {
      const manip = await ImageManipulator.manipulateAsync(asset.uri, [], {
        compress: 0.95,
        format: ImageManipulator.SaveFormat.JPEG,
      })
      uri = manip.uri
      mime = 'image/jpeg'
      extension = 'jpg'
    }

    if (!extension) {
      extension = mime === 'image/png' ? 'png' : mime === 'application/pdf' ? 'pdf' : 'jpg'
    }

    const sanitizedBase = originalName.replace(/\.[^/.]+$/, '') || 'photo'
    const finalName = `${sanitizedBase.replace(/[^a-zA-Z0-9_-]+/g, '-')}.${extension}`

    return { uri, name: finalName, mime }
  }, [])

  const requestPhotoPermission = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert(String(i18n.t('library.permissionPhotos')))
      return false
    }
    return true
  }, [])

  const requestCameraPermission = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) {
      Alert.alert(String(i18n.t('library.permissionCamera')))
      return false
    }
    return true
  }, [])

  const uploadAssets = useCallback(
    async (record: any, assets: PreparedAsset[], options?: { isPhoto?: boolean }) => {
      if (!assets.length) return
      const appliance = record.appliance
      const base = apiBase || defaultApiBase()
      setWorkingFor(appliance.id)
      try {
        let completed = 0
        for (let index = 0; index < assets.length; index++) {
          const asset = assets[index]
          const prefix = assets.length > 1 ? `${index + 1}/${assets.length} · ` : ''
          setLoadingMsg(prefix + String(i18n.t(options?.isPhoto ? 'library.photoUploading' : 'library.uploading')))
          const saved = await fs.saveToSandbox(asset.uri, asset.name, asset.mime)
          const fileId = await db.addFile(appliance.id, saved)
          try {
            const uploaded = await api.upload(base, appliance.name, saved, ns)
            if (uploaded?.s3?.key) {
              await db.setFileS3Key(fileId, uploaded.s3.key)
            }
            setLoadingMsg(prefix + String(i18n.t(options?.isPhoto ? 'library.photoProcessing' : 'library.indexing')))
            const start = await api.ingestStart(base, uploaded.s3.bucket, uploaded.s3.key, appliance.name, saved.mime, ns)
            setBusyJob(start.job_id)
            const begin = Date.now()
            let res: any = null
            while (true) {
              await new Promise((resolve) => setTimeout(resolve, 1500))
              const st = await api.ingestStatus(base, start.job_id)
              if (st.state === 'done') { res = st; break }
              if (st.state === 'error') { throw new Error(st.error || 'ingest failed') }
              if (Date.now() - begin > 10 * 60 * 1000) { throw new Error('timeout') }
            }
            try {
              await addHistory({ type: 'index', title: saved.name, meta: { appliance: appliance.name, pages: res.pages, chunks: res.chunks } })
            } catch {}
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
            completed += 1
          } catch (err: any) {
            Alert.alert('Error', err?.message || String(err))
          } finally {
            setBusyJob(null)
            setLoadingMsg(null)
          }
        }
      } finally {
        setBusyJob(null)
        setWorkingFor(null)
        setLoadingMsg(null)
        await refresh()
      }
    },
    [apiBase, ns, db, refresh]
  )

  const handlePickDocument = useCallback(async (record: any) => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true })
    if (result.canceled || !result.assets?.length) return
    const doc = result.assets[0]
    const name = doc.name || `file_${Date.now()}`
    const mime = doc.mimeType || 'application/octet-stream'
    await uploadAssets(record, [{ uri: doc.uri, name, mime }])
  }, [uploadAssets])

  const handleAddPhotos = useCallback(async (record: any) => {
    const granted = await requestPhotoPermission()
    if (!granted) return
    const res = await ImagePicker.launchImageLibraryAsync({ allowsMultipleSelection: true, selectionLimit: 0, mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 })
    if (res.canceled || !res.assets?.length) return
    const prepared: PreparedAsset[] = []
    for (const asset of res.assets) {
      prepared.push(await prepareImageAsset(asset))
    }
    await uploadAssets(record, prepared, { isPhoto: true })
  }, [prepareImageAsset, requestPhotoPermission, uploadAssets])

  const handleCapturePhoto = useCallback(async (record: any) => {
    const granted = await requestCameraPermission()
    if (!granted) return
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 })
    if (res.canceled || !res.assets?.length) return
    const prepared = [await prepareImageAsset(res.assets[0])]
    await uploadAssets(record, prepared, { isPhoto: true })
  }, [prepareImageAsset, requestCameraPermission, uploadAssets])

  const showAddDocumentMenu = useCallback((record: any) => {
    const options = [
      String(i18n.t('library.addFile')),
      String(i18n.t('library.addPhotos')),
      String(i18n.t('library.capturePhoto')),
      String(i18n.t('common.cancel')),
    ]
    const cancelIndex = options.length - 1
    const handleIndex = (index: number) => {
      if (index === 0) handlePickDocument(record)
      else if (index === 1) handleAddPhotos(record)
      else if (index === 2) handleCapturePhoto(record)
    }
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: String(i18n.t('library.addDocuments')),
          options,
          cancelButtonIndex: cancelIndex,
        },
        (idx) => {
          if (idx === undefined || idx === cancelIndex) return
          handleIndex(idx)
        }
      )
    } else {
      Alert.alert(String(i18n.t('library.addDocuments')), '', [
        { text: options[0], onPress: () => handlePickDocument(record) },
        { text: options[1], onPress: () => handleAddPhotos(record) },
        { text: options[2], onPress: () => handleCapturePhoto(record) },
        { text: options[cancelIndex], style: 'cancel' },
      ])
    }
  }, [handlePickDocument, handleAddPhotos, handleCapturePhoto])

  useEffect(() => { (async () => {
    await getSession();
    const nsVal = await ensureNamespace();
    setNs(nsVal);
    const fallbackBase = defaultApiBase()
    setApiBase((await AsyncStorage.getItem('api_base')) || fallbackBase);
    await refresh();
    // After initial refresh, if local list empty but remote manuals exist, import them
    try {
      const current = await db.listAppliances();
      if (current.length === 0) {
        const fallbackBase = defaultApiBase()
        const base = (await AsyncStorage.getItem('api_base')) || fallbackBase
    const remote = await api.listManuals(base, nsVal);
    const mapRaw = await AsyncStorage.getItem(`rename_map:${nsVal}`)
    const renameMap: Record<string,string> = mapRaw ? JSON.parse(mapRaw) : {}
        if (remote.manual_ids?.length) {
      for (const mid of remote.manual_ids) {
            try {
        // Create appliance if missing, store stable manual_id
        const existing = await db.getApplianceByManualId(mid) || await db.getApplianceByName(mid)
      const desiredName = renameMap[mid] || mid
      const appId = existing?.id || await db.createAppliance(desiredName, mid)
              // Pull remote files and add file rows with names
              const files = await api.listManualFiles(base, mid, nsVal)
              for (const key of files.files || []) {
                const parts = key.split('/')
                const fname = parts[parts.length - 1] || 'file'
                await db.addRemoteFile(appId, fname, key)
              }
            } catch {}
          }
          await refresh();
        }
      }
    } catch {}
  })() }, [refresh])

  // On focus, re-run ensureNamespace in case the user switched in another tab/screen
  useFocusEffect(useCallback(() => {
    let active = true
    ;(async () => {
      try { const cur = await ensureNamespace(); if (active) setNs(cur); } catch {}
    })()
    return () => { active = false }
  }, []))
  useEffect(() => {
    const handler = (l: string) => setLng(l)
    // @ts-ignore
    i18n.on && i18n.on('languageChanged', handler)
    return () => { /* @ts-ignore */ i18n.off && i18n.off('languageChanged', handler) }
  }, [])

  useEffect(() => {
    const unsubscribe = listen(EVENTS.dataCleared, async () => {
      setName('')
      setList([])
      setAliasForApp(null)
      setAliases([])
      setNewAlias('')
      setMenuForApp(null)
      setRenamingForApp(null)
      setRenameValue('')
      setWorkingFor(null)
      setLoadingMsg(null)
      const fallbackBase = defaultApiBase()
      const base = (await AsyncStorage.getItem('api_base')) || fallbackBase
      setApiBase(base)
      const nsVal = await ensureNamespace()
      setNs(nsVal)
      await refresh()
    })
    return unsubscribe
  }, [refresh])

  return (
    <>
    <ScrollView style={{ flex: 1, padding: 16 }} contentInsetAdjustmentBehavior="automatic">
      {/* Section 1: Add new product */}
      <Text style={s.sectionTitle}>{String(i18n.t('library.sectionAdd'))}</Text>
      <View style={s.card}>
        <Text style={s.label}>{String(i18n.t('library.newAppliance'))}</Text>
        <TextInput value={name} onChangeText={setName} placeholder={String(i18n.t('library.placeholderAppliance'))} style={s.input} />
        <View style={{ height: 8 }} />
        <Pressable
          accessibilityRole='button'
          onPress={async () => {
            if (!name.trim()) return
            const id = await db.createAppliance(name.trim())
            setName('')
            refresh()
          }}
          disabled={!name.trim()}
          style={[s.primaryButton, !name.trim() && s.disabled]}
        >
          <Text style={s.primaryButtonText}>{String(i18n.t('library.create'))}</Text>
        </Pressable>
      </View>

      {/* Section 2: Existing products */}
      <Text style={[s.sectionTitle,{marginTop:16}]}>{String(i18n.t('library.sectionExisting'))}</Text>

      {list.map(item => (
        <View style={s.card} key={item.appliance.id}>
          <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
            <Text style={s.title}>{item.appliance.name}</Text>
            <Pressable onPress={()=> setMenuForApp(item.appliance.id)} accessibilityRole='button' style={s.iconButton}>
              <Ionicons name='ellipsis-horizontal' size={22} color='#111827' />
            </Pressable>
          </View>
          <View style={s.pillRow}>
            <Pressable
              accessibilityRole='button'
              style={[s.pillPrimary, (workingFor===item.appliance.id || !!busyJob) && s.disabled]}
              disabled={!!busyJob || workingFor===item.appliance.id}
              onPress={()=>showAddDocumentMenu(item)}
            >
              <Ionicons name='add-circle-outline' size={18} color='#fff' />
              <Text style={s.pillPrimaryText}>{String(i18n.t('library.addDocuments'))}</Text>
            </Pressable>
            <Pressable
              accessibilityRole='button'
              style={[s.pill, (workingFor===item.appliance.id || !!busyJob) && s.disabled]}
              disabled={!!busyJob || workingFor===item.appliance.id}
              onPress={async ()=>{
                setAliasForApp(item.appliance.id)
                setAliases(await db.listAliases(item.appliance.id))
              }}
            >
              <Ionicons name='pricetags-outline' size={16} color='#111827' />
              <Text style={s.pillText}>{String(i18n.t('library.aliases'))}</Text>
            </Pressable>
          </View>
          {workingFor===item.appliance.id && !!loadingMsg && (
            <View style={s.uploadStatus}>
              <ActivityIndicator size='small' color='#0A84FF' />
              <Text style={s.uploadStatusText}>{loadingMsg}</Text>
            </View>
          )}

          {item.files.map((f:any) => (
            <View key={f.id} style={{ borderTopWidth: 1, borderTopColor: '#223244', paddingTop: 8, marginTop: 8, flexDirection:'row', alignItems:'center' }}>
              <Text style={[s.fileText, { flex:1, marginRight:8, flexShrink:1 }]}>{truncateFileName(f.name)} ({Math.round(f.size/1024)} KB)</Text>
              <Pressable accessibilityRole='button' onPress={async ()=>{
                Alert.alert(String(i18n.t('library.deleteFile')), f.name, [
                  { text: String(i18n.t('common.cancel')) },
                  { text: String(i18n.t('common.delete')), style:'destructive', onPress: async () => {
                    try {
                      // resolve s3 key
                      let key = f.s3_key as string | undefined
                      let manualForDelete = item.appliance.name
                      if (!key) {
                        // Try current manual id first
                        try {
                          const listResp = await api.listManualFiles(apiBase, manualForDelete, ns)
                          key = (listResp.files||[]).find((k:string)=> k.endsWith('/'+f.name))
                        } catch {}
                        // Fallback: scan all manuals to locate the key by filename (covers renamed products)
                        if (!key) {
                          try {
                            const all = await api.listManuals(apiBase, ns)
                            for (const mid of all.manual_ids || []) {
                              try {
                                const files = await api.listManualFiles(apiBase, mid, ns)
                                const found = (files.files||[]).find((k:string)=> k.endsWith('/'+f.name))
                                if (found) { key = found; manualForDelete = mid; break }
                              } catch {}
                            }
                          } catch {}
                        }
                      }
                      if (key) {
                        // choose manual id matching the key prefix to satisfy server check
                        const parts = key.split('/')
                        if (parts.length >= 2) {
                          if (ns && key.startsWith(ns + '/')) manualForDelete = parts[1]
                          else manualForDelete = parts[0]
                        }
                        await api.deleteFile(apiBase, manualForDelete, key, ns)
                      } else {
                        throw new Error('Remote file key not found')
                      }
                      await db.deleteFile(f.id)
                      refresh()
                    } catch(e:any) {
                      Alert.alert('Delete failed', e?.message || String(e))
                    }
                  }}
                ])
              }} accessibilityLabel={String(i18n.t('library.deleteFile'))} hitSlop={{ top:8, bottom:8, left:8, right:8 }} style={s.iconDel}>
                <Ionicons name='trash-outline' size={14} color='#cc3344' />
              </Pressable>
            </View>
          ))}
          {/* Overflow menu */}
          <Modal visible={menuForApp===item.appliance.id} transparent animationType='fade' onRequestClose={()=>setMenuForApp(null)}>
            <Pressable style={{ flex:1, backgroundColor:'rgba(0,0,0,0.2)', justifyContent:'flex-end' }} onPress={()=>setMenuForApp(null)}>
              <View style={{ backgroundColor:'#fff', borderTopLeftRadius:16, borderTopRightRadius:16, padding:8 }}>
                <Pressable onPress={() => { setMenuForApp(null); setRenamingForApp(item.appliance.id); setRenameValue(item.appliance.name) }} style={s.menuRow} accessibilityRole='button'>
                  <Ionicons name='create-outline' size={18} color='#111827' />
                  <Text style={s.menuText}>{String(i18n.t('library.rename'))}</Text>
                </Pressable>
                <Pressable onPress={async () => {
                  setMenuForApp(null)
                  Alert.alert(String(i18n.t('library.deleteAppliance')), item.appliance.name, [
                    { text: String(i18n.t('common.cancel')) },
                    { text: String(i18n.t('common.delete')), style:'destructive', onPress: async ()=>{
                        try {
                          // Attempt remote delete using stable manual_id if available
                          const app = await db.getApplianceById(item.appliance.id)
                          const manualId = app?.manual_id || item.appliance.name
                          await api.deleteManual(apiBase, manualId, ns)
                        } catch {}
                        await db.deleteAppliance(item.appliance.id);
                        refresh()
                      } }
                  ])
                }} style={s.menuRow} accessibilityRole='button'>
                  <Ionicons name='trash-outline' size={18} color='#cc3344' />
                  <Text style={[s.menuText,{ color:'#cc3344' }]}>{String(i18n.t('common.delete'))}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Modal>
          <Modal visible={aliasForApp===item.appliance.id} transparent animationType='slide' onRequestClose={()=>setAliasForApp(null)}>
            <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.2)', justifyContent:'flex-end' }}>
              <Pressable style={{ flex:1 }} onPress={()=>setAliasForApp(null)} />
              <View style={{ backgroundColor:'#fff', borderTopLeftRadius:16, borderTopRightRadius:16, padding:16 }}>
                <Text style={{ fontSize:18, fontWeight:'600' }}>Aliases for {item.appliance.name}</Text>
                <View style={{ flexDirection:'row', gap:8, marginTop:12 }}>
                  <TextInput placeholder='Add alias (e.g., coffee machine)' value={newAlias} onChangeText={setNewAlias} style={{ flex:1, borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, padding:10 }} />
                  <Button title='Add' onPress={async()=>{ if(!newAlias.trim()) return; await db.addAlias(item.appliance.id, newAlias.trim()); setNewAlias(''); setAliases(await db.listAliases(item.appliance.id)); }} />
                </View>
                <View style={{ marginTop:12 }}>
                  {aliases.map((al:any)=> (
                    <View key={al.id} style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical:10 }}>
                      <Text>{al.alias}</Text>
                      <Button title='Delete' color='#cc3344' onPress={async()=>{ await db.deleteAlias(al.id); setAliases(await db.listAliases(item.appliance.id)) }} />
                    </View>
                  ))}
                  {aliases.length===0 && <Text style={{ color:'#6b7c90', marginTop:8 }}>No aliases yet</Text>}
                </View>
                <View style={{ height:8 }} />
                <Button title={String(i18n.t('common.done'))} onPress={()=>setAliasForApp(null)} />
              </View>
            </View>
          </Modal>

          <Modal visible={renamingForApp===item.appliance.id} transparent animationType='slide' onRequestClose={()=>setRenamingForApp(null)}>
            <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.2)', justifyContent:'flex-end' }}>
              <Pressable style={{ flex:1 }} onPress={()=>setRenamingForApp(null)} />
              <View style={{ backgroundColor:'#fff', borderTopLeftRadius:16, borderTopRightRadius:16, padding:16 }}>
                <Text style={{ fontSize:18, fontWeight:'600' }}>{String(i18n.t('library.renameProduct'))}</Text>
                <View style={{ flexDirection:'row', gap:8, marginTop:12 }}>
                  <TextInput placeholder={String(i18n.t('library.newAppliance'))} value={renameValue} onChangeText={setRenameValue} style={{ flex:1, borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, padding:10 }} />
                  <Button title={String(i18n.t('common.save'))} onPress={async()=>{
                    if(!renameValue.trim()) return;
                    await db.renameAppliance(item.appliance.id, renameValue.trim());
                    // Persist rename map keyed by manual_id within current namespace
                    try {
                      const fallbackBase = defaultApiBase()
                      const base = (await AsyncStorage.getItem('api_base')) || fallbackBase
                      const nsVal = (await AsyncStorage.getItem('namespace')) || ''
                      const app = await db.getApplianceById(item.appliance.id)
                      const manualId = app?.manual_id || app?.name || renameValue.trim()
                      const key = `rename_map:${nsVal}`
                      const raw = await AsyncStorage.getItem(key)
                      const map = raw ? JSON.parse(raw) : {}
                      if (manualId) map[manualId] = renameValue.trim()
                      await AsyncStorage.setItem(key, JSON.stringify(map))
                    } catch {}
                    setRenamingForApp(null); refresh();
                  }} />
                </View>
              </View>
            </View>
          </Modal>
        </View>
      ))}
    </ScrollView>
    {/* Busy overlay */}
    <Modal visible={!!loadingMsg && !workingFor} transparent animationType='fade' onRequestClose={()=>setLoadingMsg(null)}>
      <View style={s.busyOverlay}>
        <View style={s.busyCard}>
          <ActivityIndicator size='large' color='#0A84FF' />
          <Text style={s.busyText}>{loadingMsg || ''}</Text>
        </View>
      </View>
    </Modal>
    </>
  )
}

const s = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '600', marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '500', marginTop: 4, color:'#6b7c90' },
  card: { borderWidth: 1, borderColor: '#223244', borderRadius: 10, padding: 12, marginTop: 8 },
  label: { color: '#6b7c90', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#223244', padding: 10, borderRadius: 8 },
  title: { fontSize: 16, fontWeight: '500', color:'#111827' },
  primaryButton: { alignSelf:'flex-end', backgroundColor:'#0A84FF', borderRadius:14, paddingVertical:10, paddingHorizontal:16 },
  primaryButtonText: { color:'#fff', fontSize:16, fontWeight:'700' },
  disabled: { opacity: 0.5 },
  pillRow: { flexDirection:'row', gap:8, marginVertical:8, flexWrap:'wrap' },
  pill: { flexDirection:'row', alignItems:'center', gap:6, paddingVertical:8, paddingHorizontal:12, borderRadius:12, borderWidth:1, borderColor:'#D1D5DB', backgroundColor:'#fff' },
  pillText: { color:'#111827', fontWeight:'500' },
  pillPrimary: { flexDirection:'row', alignItems:'center', gap:6, paddingVertical:10, paddingHorizontal:14, borderRadius:12, backgroundColor:'#0A84FF', borderWidth:1, borderColor:'#0A84FF' },
  pillPrimaryText: { color:'#fff', fontWeight:'700' },
  pillDanger: { flexDirection:'row', alignItems:'center', gap:6, paddingVertical:8, paddingHorizontal:12, borderRadius:12, borderWidth:1, borderColor:'#FCA5A5', backgroundColor:'#FFF1F2' },
  pillDangerText: { color:'#cc3344', fontWeight:'600' },
  uploadStatus: { flexDirection:'row', alignItems:'center', gap:8, marginBottom:4 },
  uploadStatusText: { color:'#0A84FF', fontSize:13, fontWeight:'500' },
  ghostPill: { flexDirection:'row', alignItems:'center', backgroundColor:'#fff', borderRadius:18, paddingVertical:8, paddingHorizontal:12, borderWidth:1, borderColor:'#D1D5DB' },
  ghostPillText: { color:'#111827', fontSize:16, fontWeight:'500' },
  iconButton: { padding:6, borderRadius:16, borderWidth:1, borderColor:'#E5E7EB', backgroundColor:'#fff' },
  menuRow: { flexDirection:'row', alignItems:'center', gap:10, paddingVertical:12, paddingHorizontal:16 },
  menuText: { fontSize:16, color:'#111827' },
  iconDel: { width:28, height:28, borderRadius:14, backgroundColor:'#FFF1F2', borderWidth:1, borderColor:'#FCA5A5', alignItems:'center', justifyContent:'center' },
  fileText: { fontSize:14, color:'#6b7c90' },
  busyOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.25)', justifyContent:'center', alignItems:'center' },
  busyCard: { backgroundColor:'#fff', padding:16, borderRadius:12, width:'70%', alignItems:'center' },
  busyText: { marginTop:10, color:'#111827' }
})

function truncateFileName(name: string, max = 32) {
  if (!name) return name
  if (name.length <= max) return name
  const keepStart = Math.max(8, Math.floor(max * 0.3))
  const keepEnd = max - keepStart - 3
  return `${name.slice(0, keepStart)}...${name.slice(-keepEnd)}`
}
