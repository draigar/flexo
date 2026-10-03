import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { IpcContract } from '@shared/ipc-contract'
import type {
  AppSettings,
  DownloadRecord,
  DownloadState,
  InitialState,
  MediaCandidate,
  NetworkSpeedSnapshot,
  QueueItem,
  StartDownloadRequest,
  StartSimulatedDownloadRequest
} from '@shared/types'

const fallbackInitialState: InitialState = {
  homeDir: '',
  downloadsDir: '',
  isDev: import.meta.env.DEV,
  themeSource: 'dark',
  networkPreferences: {},
  streamsPerNetwork: 2,
  segmentPreset: 'auto',
  autoDownload: true,
  watchClipboard: true
}

let cachedInitial: InitialState = fallbackInitialState

export async function bootstrapFlexo(): Promise<InitialState> {
  try {
    cachedInitial = await invoke<InitialState>('getInitialState')
  } catch {
    cachedInitial = fallbackInitialState
  }
  return cachedInitial
}

function platform(): NodeJS.Platform {
  const p = navigator.platform.toLowerCase()
  if (p.includes('mac')) return 'darwin'
  if (p.includes('win')) return 'win32'
  return 'linux'
}

export const flexoApi = {
  platform: platform(),

  get initialState(): InitialState {
    return cachedInitial
  },

  listInterfaces: () => invoke<IpcContract['listInterfaces']['result']>('listInterfaces'),
  pingInterfaces: () => invoke<IpcContract['pingInterfaces']['result']>('pingInterfaces'),
  deviceBindingSupported: () =>
    invoke<IpcContract['deviceBindingSupported']['result']>('deviceBindingSupported'),
  openNetworkSettings: () => invoke<void>('openNetworkSettings'),
  updateSettings: (patch: AppSettings) => invoke<void>('updateSettings', { payload: patch }),
  probeUrl: (url: string) =>
    invoke<IpcContract['probeUrl']['result']>('probeUrl', { payload: url }),
  chooseDestinationFolder: (defaultPath: string) =>
    invoke<string | null>('chooseDestinationFolder', { payload: defaultPath }),
  chooseSourceFile: () => invoke<string | null>('chooseSourceFile'),
  readClipboardText: () => invoke<string>('readClipboardText'),
  revealInFolder: (filePath: string) => invoke<void>('revealInFolder', { payload: filePath }),
  revealCaptureExtension: () => invoke<void>('revealCaptureExtension'),
  listDownloadHistory: () => invoke<DownloadRecord[]>('listDownloadHistory'),
  removeDownloadHistory: (id: string) => invoke<void>('removeDownloadHistory', { payload: id }),
  startDownload: (request: StartDownloadRequest) =>
    invoke<string>('startDownload', { payload: request }),
  startSimulatedDownload: (request: StartSimulatedDownloadRequest) =>
    invoke<string>('startSimulatedDownload', { payload: request }),
  getCurrentDownload: () => invoke<DownloadState | null>('getCurrentDownload'),
  getActiveDownloads: () => invoke<DownloadState[]>('getActiveDownloads'),
  pauseDownload: (downloadId: string) => invoke<void>('pauseDownload', { payload: downloadId }),
  resumeDownload: (downloadId: string) => invoke<void>('resumeDownload', { payload: downloadId }),
  cancelDownload: (downloadId: string) => invoke<void>('cancelDownload', { payload: downloadId }),
  removeDownload: (downloadId: string) => invoke<void>('removeDownload', { payload: downloadId }),
  checkForUpdate: () => invoke<IpcContract['checkForUpdate']['result']>('checkForUpdate'),

  getQueue: () => invoke<QueueItem[]>('getQueue'),
  enqueueDownload: (request: StartDownloadRequest) =>
    invoke<string>('enqueueDownload', { payload: request }),
  resolveMedia: (url: string) => invoke<MediaCandidate[]>('resolveMedia', { url }),
  startMediaDownload: (candidateId: string, request: StartDownloadRequest) =>
    invoke<string>('startMediaDownload', { candidateId, payload: request }),

  onDownloadUpdated: (callback: (state: DownloadState) => void): (() => void) => {
    let unlisten: UnlistenFn | undefined
    void listen<DownloadState>('download:updated', (event) => callback(event.payload)).then(
      (fn) => {
        unlisten = fn
      }
    )
    return () => unlisten?.()
  },

  onQueueUpdated: (callback: (queue: QueueItem[]) => void): (() => void) => {
    let unlisten: UnlistenFn | undefined
    void listen<QueueItem[]>('queue:updated', (event) => callback(event.payload)).then((fn) => {
      unlisten = fn
    })
    return () => unlisten?.()
  },

  onHistoryUpdated: (callback: () => void): (() => void) => {
    let unlisten: UnlistenFn | undefined
    void listen('history:updated', () => callback()).then((fn) => {
      unlisten = fn
    })
    return () => unlisten?.()
  },

  onCaptureFailed: (
    callback: (failure: { url: string; message: string }) => void
  ): (() => void) => {
    let unlisten: UnlistenFn | undefined
    void listen<{ url: string; message: string }>('capture:error', (event) =>
      callback(event.payload)
    ).then((fn) => {
      unlisten = fn
    })
    return () => unlisten?.()
  },

  onClipboardUrl: (callback: (url: string) => void): (() => void) => {
    let unlisten: UnlistenFn | undefined
    void listen<string>('clipboard:url', (event) => callback(event.payload)).then((fn) => {
      unlisten = fn
    })
    return () => unlisten?.()
  },

  onMediaCandidates: (callback: (candidates: MediaCandidate[]) => void): (() => void) => {
    let unlisten: UnlistenFn | undefined
    void listen<MediaCandidate[]>('media:candidates', (event) => callback(event.payload)).then(
      (fn) => {
        unlisten = fn
      }
    )
    return () => unlisten?.()
  },

  onToggleDevToolsPanel: (callback: () => void): (() => void) => {
    let unlisten: UnlistenFn | undefined
    void listen('dev:toggle-panel', () => callback()).then((fn) => {
      unlisten = fn
    })
    return () => unlisten?.()
  },

  presentMainWindow: () => invoke<void>('presentMainWindow'),
  hideTrayPopover: () => invoke<void>('hideTrayPopover'),
  quitApp: () => invoke<void>('quitApp'),
  getNetworkSpeeds: () => invoke<NetworkSpeedSnapshot>('getNetworkSpeeds'),
  triggerSpeedTest: () => invoke<NetworkSpeedSnapshot>('triggerSpeedTest'),

  onNetworkSpeeds: (callback: (snapshot: NetworkSpeedSnapshot) => void): (() => void) => {
    let unlisten: UnlistenFn | undefined
    void listen<NetworkSpeedSnapshot>('network:speeds', (event) => callback(event.payload)).then(
      (fn) => {
        unlisten = fn
      }
    )
    return () => unlisten?.()
  }
}

export type FlexoApi = typeof flexoApi
