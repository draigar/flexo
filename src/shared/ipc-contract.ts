import type {
  AppSettings,
  DownloadState,
  MediaCandidate,
  NetworkInterfaceInfo,
  ProbeResult,
  QueueItem,
  StartDownloadRequest,
  StartSimulatedDownloadRequest,
  UpdateInfo
} from './types'

/** The request/response half of the IPC surface (every IpcChannels entry except push events) —
 * one source of truth for flexoApi and the Tauri command layer. */
export interface IpcContract {
  listInterfaces: { args: []; result: NetworkInterfaceInfo[] }
  pingInterfaces: { args: []; result: Record<string, number | null> }
  deviceBindingSupported: { args: []; result: boolean }
  openNetworkSettings: { args: []; result: void }
  updateSettings: { args: [patch: AppSettings]; result: void }
  probeUrl: { args: [url: string]; result: ProbeResult }
  chooseDestinationFolder: { args: [defaultPath: string]; result: string | null }
  chooseSourceFile: { args: []; result: string | null }
  readClipboardText: { args: []; result: string }
  revealInFolder: { args: [filePath: string]; result: void }
  startDownload: { args: [request: StartDownloadRequest]; result: string }
  startSimulatedDownload: { args: [request: StartSimulatedDownloadRequest]; result: string }
  getCurrentDownload: { args: []; result: DownloadState | null }
  getActiveDownloads: { args: []; result: DownloadState[] }
  pauseDownload: { args: [id: string]; result: void }
  resumeDownload: { args: [id: string]; result: void }
  cancelDownload: { args: [id: string]; result: void }
  removeDownload: { args: [id: string]; result: void }
  checkForUpdate: { args: []; result: UpdateInfo | null }
  getQueue: { args: []; result: QueueItem[] }
  enqueueDownload: { args: [request: StartDownloadRequest]; result: string }
  resolveMedia: { args: [url: string]; result: MediaCandidate[] }
  startMediaDownload: {
    args: [candidateId: string, request: StartDownloadRequest]
    result: string
  }
  presentMainWindow: { args: []; result: void }
  hideTrayPopover: { args: []; result: void }
  quitApp: { args: []; result: void }
  getNetworkSpeeds: { args: []; result: import('./types').NetworkSpeedSnapshot }
  triggerSpeedTest: { args: []; result: import('./types').NetworkSpeedSnapshot }
}
