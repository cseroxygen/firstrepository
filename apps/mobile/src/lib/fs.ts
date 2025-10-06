import * as FileSystem from 'expo-file-system'
import * as Crypto from 'expo-crypto'

export const fs = {
  async saveToSandbox(uri: string, name: string, mime: string) {
    const dir = FileSystem.documentDirectory + 'manuals/'
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true })
    const dest = dir + Date.now() + '_' + name.replace(/[^a-zA-Z0-9_.-]+/g, '_')
    await FileSystem.copyAsync({ from: uri, to: dest })
  const info = await FileSystem.getInfoAsync(dest)
    const sha256 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, dest)
  const size = (info as any)?.size ?? 0
  return { path: dest, name, mime, size, sha256 }
  },
}

