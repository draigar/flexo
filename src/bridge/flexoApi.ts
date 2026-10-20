import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { IpcContract } from '@shared/ipc-contract'
import type {
  AppSettings,
  DownloadRecord,
  DownloadState,
  FinishedDownload,
  InitialState,
  MediaCandidate,
  NetworkSpeedSnapshot,
  PendingLink,
  ProbeUrlPayload,
  QueueItem,
  StartDownloadRequest,
  StartSimulatedDownloadRequest
} from '@shared/types'
import type { BridgeAddRequest } from '@shared/browserBridge'

const fallbackInitialState: InitialState = {
  homeDir: '',
  downloadsDir: '',
  isDev: import.meta.env.DEV,
  themeSource: 'dark',
  networkPreferences: {},
  downloadsAtOnce: 2,
  slowMode: false,
  slowModeSpeed: 2 * 1024 ** 2,
  speedUnit: 'bytes',
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
  probeUrl: (payload: ProbeUrlPayload) =>
    invoke<IpcContract['probeUrl']['result']>('probeUrl', { payload }),
  chooseDestinationFolder: (defaultPath: string) =>
    invoke<string | null>('chooseDestinationFolder', { payload: defaultPath }),
  chooseSourceFile: () => invoke<string | null>('chooseSourceFile'),
  readClipboardText: () => invoke<string>('readClipboardText'),
  openPath: (filePath: string) => invoke<void>('openPath', { payload: filePath }),
  revealInFolder: (filePath: string) => invoke<void>('revealInFolder', { payload: filePath }),
  revealCaptureExtension: () => invoke<void>('revealCaptureExtension'),
  listDownloadHistory: () => invoke<DownloadRecord[]>('listDownloadHistory'),
  listHistory: async (): Promise<FinishedDownload[]> => {
    const records = await invoke<DownloadRecord[]>('listDownloadHistory').catch(() => [])
    return records.map((rec) => ({
      id: rec.id,
      url: rec.url,
      fileName: rec.fileName,
      filePath: rec.destinationPath,
      destinationPath: rec.destinationPath,
      totalBytes: rec.totalBytes,
      bytesDownloaded: rec.totalBytes,
      speedBytesPerSec: 0,
      status: 'completed' as const,
      startedAt: rec.startedAt,
      completedAt: rec.completedAt,
      kind: 'http' as const,
      networks: [],
      peakStreams: 1,
      totalBlocks: 1,
      blockSizeBytes: rec.totalBytes,
      unitsWritten: 1
    }))
  },
  listDownloads: async (): Promise<DownloadState[]> => {
    return invoke<DownloadState[]>('getActiveDownloads').catch(() => [])
  },
  pendingLinks: async (): Promise<PendingLink[]> => {
    return []
  },
  dismissLink: async (_id: string): Promise<void> => {},
  removeDownloadHistory: (id: string) => invoke<void>('removeDownloadHistory', { payload: id }),
  startDownload: (request: StartDownloadRequest) =>
    invoke<string>('startDownload', { payload: request }),
  startSimulatedDownload: (request: StartSimulatedDownloadRequest) =>
    invoke<string>('startSimulatedDownload', { payload: request }),
  getCurrentDownload: () => invoke<DownloadState | null>('getCurrentDownload'),
  getActiveDownloads: () => invoke<DownloadState[]>('getActiveDownloads'),
  pauseDownload: (downloadId: string) => invoke<void>('pauseDownload', { payload: downloadId }),
  resumeDownload: (downloadId: string) => invoke<void>('resumeDownload', { payload: downloadId }),
  relinkDownload: (downloadId: string, url: string) =>
    invoke<void>('relinkDownload', { id: downloadId, url }),
  cancelDownload: (downloadId: string) => invoke<void>('cancelDownload', { payload: downloadId }),
  removeDownload: (downloadId: string) => invoke<void>('removeDownload', { payload: downloadId }),
  setDownloadNetwork: async (_downloadId: string, _networkId: string, _enabled: boolean): Promise<void> => {},
  resetNetworkUsage: async (_id: string): Promise<void> => {},
  torrentFiles: async (_downloadId: string): Promise<any[]> => [],
  chooseTorrentFiles: async (_downloadId: string, _indices: number[]): Promise<void> => {},
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

  onHistoryChanged: (callback: () => void): (() => void) => {
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

  onBridgeAdd: (callback: (request: BridgeAddRequest) => void): (() => void) => {
    let unlisten: UnlistenFn | undefined
    void listen<BridgeAddRequest>('bridge:add', (event) => callback(event.payload)).then((fn) => {
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
