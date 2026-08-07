/**
 * غلاف التحديث التلقائي — المرحلة 6B.
 * لا يعمل في وضع التطوير، ويستخدم GitHub Releases الذي يُحدد في
 * electron-builder.yml. التنزيل لا يبدأ تلقائيًا حتى يطلبه المدير.
 */
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'
import type { UpdateState } from '../shared/types'

let state: UpdateState = {
  phase: 'idle',
  version: null,
  progress: 0,
  error: null
}
let configured = false

function setState(next: Partial<UpdateState>): UpdateState {
  state = { ...state, ...next }
  return state
}

export function configureAutoUpdater(): void {
  if (configured || !app.isPackaged) return
  configured = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('checking-for-update', () => setState({ phase: 'checking', error: null }))
  autoUpdater.on('update-available', (info: UpdateInfo) =>
    setState({ phase: 'available', version: info.version, progress: 0, error: null })
  )
  autoUpdater.on('update-not-available', () => setState({ phase: 'not-available', error: null }))
  autoUpdater.on('download-progress', (progress) =>
    setState({ phase: 'downloading', progress: Math.max(0, Math.min(100, progress.percent)), error: null })
  )
  autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
    setState({ phase: 'downloaded', version: info.version, progress: 100, error: null })
  )
  autoUpdater.on('error', (error) => setState({ phase: 'error', error: error.message }))
}

export function getUpdateState(): UpdateState {
  return { ...state }
}

export async function checkForUpdates(): Promise<UpdateState> {
  configureAutoUpdater()
  if (!app.isPackaged) return setState({ phase: 'not-available', error: 'التحديث متاح داخل النسخة المثبتة فقط' })
  try {
    await autoUpdater.checkForUpdates()
    return getUpdateState()
  } catch (error) {
    return setState({ phase: 'error', error: (error as Error).message })
  }
}

export async function downloadUpdate(): Promise<UpdateState> {
  configureAutoUpdater()
  if (!app.isPackaged) return setState({ phase: 'error', error: 'التحديث متاح داخل النسخة المثبتة فقط' })
  try {
    setState({ phase: 'downloading', progress: 0, error: null })
    await autoUpdater.downloadUpdate()
    return getUpdateState()
  } catch (error) {
    return setState({ phase: 'error', error: (error as Error).message })
  }
}

export function installDownloadedUpdate(): void {
  if (!app.isPackaged) throw new Error('التحديث متاح داخل النسخة المثبتة فقط')
  if (state.phase !== 'downloaded') throw new Error('لا توجد حزمة تحديث جاهزة للتثبيت')
  autoUpdater.quitAndInstall(false, true)
}
