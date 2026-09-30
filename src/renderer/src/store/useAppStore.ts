import type {
  AppSettings,
  DownloadState,
  MediaCandidate,
  NetworkInterfaceInfo,
  NetworkPreference,
  NetworkPreferences,
  QueueItem,
  SegmentPreset,
  ThemeSource,
  UpdateInfo
} from '@shared/types'
import { create } from 'zustand'
import { groupChunksByInterface } from '../utils/format'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

const SPEED_HISTORY_LENGTH = 60
const SPEED_SAMPLE_INTERVAL_MS = 1000

let lastSpeedSampleAt = 0

interface AppStore {
  interfaces: NetworkInterfaceInfo[]
  interfacesStatus: LoadStatus
  interfacesError: string | null
  latencies: Record<string, number | null>
  networkPreferences: NetworkPreferences

  themeSource: ThemeSource
  streamsPerNetwork: number
  segmentPreset: SegmentPreset
  autoDownload: boolean
  watchClipboard: boolean
  page: 'home' | 'settings' | 'library' | 'ongoing'

  availableUpdate: UpdateInfo | null

  homeDir: string
  downloadsDir: string
  isDev: boolean

  activeDownloads: Record<string, DownloadState>
  focusedDownloadId: string | null
  currentDownload: DownloadState | null
  queue: QueueItem[]
  mediaCandidates: MediaCandidate[]
  speedHistory: number[]
  speedHistoryByInterface: Record<string, number[]>
  peakSpeedBytesPerSec: number

  draftUrl: string
  captureError: string | null
  destinationDir: string
  mirrorUrls: string[]

  loadInterfaces: () => Promise<void>
  refreshLatencies: () => Promise<void>
  setNetworkPreference: (id: string, patch: NetworkPreference) => void
  setThemeSource: (source: ThemeSource) => void
  setStreamsPerNetwork: (streamsPerNetwork: number) => void
  setSegmentPreset: (segmentPreset: SegmentPreset) => void
  setAutoDownload: (autoDownload: boolean) => void
  setWatchClipboard: (watchClipboard: boolean) => void
  setPage: (page: 'home' | 'settings' | 'library' | 'ongoing') => void
  setFocusedDownloadId: (id: string | null) => void
  setActiveDownloads: (downloads: DownloadState[]) => void
  removeActiveDownload: (id: string) => void
  checkForUpdate: () => Promise<void>
  dismissUpdate: () => void
  setCurrentDownload: (state: DownloadState) => void
  clearCurrentDownload: () => void
  setDraftUrl: (url: string) => void
  setCaptureError: (message: string | null) => void
  setDestinationDir: (dir: string) => void
  setMirrorUrls: (urls: string[]) => void
  setQueue: (queue: QueueItem[]) => void
  setMediaCandidates: (candidates: MediaCandidate[]) => void
  clearMediaCandidates: () => void
}

const initial = window.flexo.initialState

function persist(patch: AppSettings): void {
  window.flexo.updateSettings(patch).catch(() => {})
}

export const useAppStore = create<AppStore>((set, get) => ({
  interfaces: [],
  interfacesStatus: 'idle',
  interfacesError: null,
  latencies: {},
  networkPreferences: initial.networkPreferences,
  themeSource: initial.themeSource,
  streamsPerNetwork: initial.streamsPerNetwork ?? 2,
  segmentPreset: initial.segmentPreset ?? 'auto',
  autoDownload: initial.autoDownload ?? true,
  watchClipboard: initial.watchClipboard ?? true,
  page: 'home',
  availableUpdate: null,

  homeDir: initial.homeDir,
  downloadsDir: initial.downloadsDir,
  isDev: initial.isDev,

  activeDownloads: {},
  focusedDownloadId: null,
  currentDownload: null,
  queue: [],
  mediaCandidates: [],
  speedHistory: [],
  speedHistoryByInterface: {},
  peakSpeedBytesPerSec: 0,

  draftUrl: '',
  captureError: null,
  destinationDir: initial.destinationDir ?? initial.downloadsDir,
  mirrorUrls: [],

  loadInterfaces: async () => {
    // A re-scan keeps showing the last result. Dropping back to 'loading' would swap App off the
    // no-connections screen, and every screen re-scans on mount — so with zero networks the
    // two screens would remount each other in an endless loop.
    if (get().interfacesStatus !== 'ready') set({ interfacesStatus: 'loading' })
    set({ interfacesError: null })
    try {
      const interfaces = await window.flexo.listInterfaces()
      set({ interfaces, interfacesStatus: 'ready' })
    } catch (error) {
      set({
        interfacesStatus: 'error',
        interfacesError: error instanceof Error ? error.message : String(error)
      })
    }
  },

  refreshLatencies: async () => {
    try {
      const latencies = await window.flexo.pingInterfaces()
      set({ latencies })
    } catch {
      // Latency is a nice-to-have readout — a failed probe just leaves stale values.
    }
  },

  // An explicit `undefined` in `patch` clears that field; main drops an entry left with neither.
  setNetworkPreference: (id, patch) => {
    const networkPreferences = {
      ...get().networkPreferences,
      [id]: { ...get().networkPreferences[id], ...patch }
    }
    set({ networkPreferences })
    persist({ networkPreferences })
  },

  setThemeSource: (themeSource) => {
    set({ themeSource })
    persist({ themeSource })
  },

  setStreamsPerNetwork: (streamsPerNetwork) => {
    set({ streamsPerNetwork })
    persist({ streamsPerNetwork })
  },

  setSegmentPreset: (segmentPreset) => {
    set({ segmentPreset })
    persist({ segmentPreset })
  },

  setAutoDownload: (autoDownload) => {
    set({ autoDownload })
    persist({ autoDownload })
  },

  setWatchClipboard: (watchClipboard) => {
    set({ watchClipboard })
    persist({ watchClipboard })
  },

  setPage: (page) => set({ page }),

  checkForUpdate: async () => {
    try {
      const availableUpdate = await window.flexo.checkForUpdate()
      set({ availableUpdate })
    } catch {
      // Best-effort — a failed check just leaves the banner hidden.
    }
  },

  dismissUpdate: () => {
    const update = get().availableUpdate
    if (!update) return
    set({ availableUpdate: { ...update, dismissed: true } })
    persist({ dismissedUpdateVersion: update.version })
  },

  setFocusedDownloadId: (id) => {
    lastSpeedSampleAt = 0
    if (!id) {
      set({
        focusedDownloadId: null,
        currentDownload: null,
        speedHistory: [],
        speedHistoryByInterface: {},
        peakSpeedBytesPerSec: 0
      })
      return
    }
    const download = get().activeDownloads[id] ?? null
    set({
      focusedDownloadId: id,
      currentDownload: download,
      speedHistory: [],
      speedHistoryByInterface: {},
      peakSpeedBytesPerSec: download?.speedBytesPerSec ?? 0
    })
  },

  setActiveDownloads: (downloads) => {
    const map: Record<string, DownloadState> = {}
    for (const d of downloads) {
      map[d.id] = d
    }
    const focusedId = get().focusedDownloadId
    const current = focusedId ? map[focusedId] ?? null : null
    set({
      activeDownloads: map,
      currentDownload: current
    })
  },

  removeActiveDownload: (id) => {
    const next = { ...get().activeDownloads }
    delete next[id]
    const updates: Record<string, unknown> = { activeDownloads: next }
    if (get().focusedDownloadId === id) {
      updates.focusedDownloadId = null
      updates.currentDownload = null
      updates.speedHistory = []
      updates.speedHistoryByInterface = {}
      updates.peakSpeedBytesPerSec = 0
    }
    set(updates)
  },

  setCurrentDownload: (download) => {
    const activeDownloads = { ...get().activeDownloads, [download.id]: download }
    const focusedDownloadId = get().focusedDownloadId

    const isFocused = focusedDownloadId === download.id
    const previous = get().currentDownload
    const isNewDownload = isFocused && (!previous || previous.id !== download.id)

    let speedHistory = isNewDownload ? [] : get().speedHistory
    let speedHistoryByInterface = isNewDownload ? {} : get().speedHistoryByInterface
    let peakSpeedBytesPerSec = isNewDownload ? 0 : get().peakSpeedBytesPerSec
    if (isNewDownload) lastSpeedSampleAt = 0

    if (isFocused && download.status === 'downloading') {
      peakSpeedBytesPerSec = Math.max(peakSpeedBytesPerSec, download.speedBytesPerSec)

      const now = Date.now()
      if (now - lastSpeedSampleAt >= SPEED_SAMPLE_INTERVAL_MS) {
        lastSpeedSampleAt = now
        speedHistory = [...speedHistory, download.speedBytesPerSec].slice(-SPEED_HISTORY_LENGTH)

        const nextByInterface: Record<string, number[]> = {}
        for (const group of groupChunksByInterface(download.chunks)) {
          const previousSeries = speedHistoryByInterface[group.interfaceId] ?? []
          nextByInterface[group.interfaceId] = [...previousSeries, group.speedBytesPerSec].slice(
            -SPEED_HISTORY_LENGTH
          )
        }
        speedHistoryByInterface = nextByInterface
      }
    }

    set({
      activeDownloads,
      focusedDownloadId,
      currentDownload: isFocused ? download : get().currentDownload,
      speedHistory: isFocused ? speedHistory : get().speedHistory,
      speedHistoryByInterface: isFocused ? speedHistoryByInterface : get().speedHistoryByInterface,
      peakSpeedBytesPerSec: isFocused ? peakSpeedBytesPerSec : get().peakSpeedBytesPerSec,
      captureError: download.status === 'downloading' ? null : get().captureError
    })
  },

  clearCurrentDownload: () => {
    const focusedId = get().focusedDownloadId
    const next = { ...get().activeDownloads }
    if (focusedId) {
      delete next[focusedId]
    }
    set({
      activeDownloads: next,
      focusedDownloadId: null,
      currentDownload: null,
      speedHistory: [],
      speedHistoryByInterface: {},
      peakSpeedBytesPerSec: 0
    })
  },

  setDraftUrl: (draftUrl) => set({ draftUrl }),
  setCaptureError: (captureError) => set({ captureError }),
  setDestinationDir: (destinationDir) => {
    set({ destinationDir })
    persist({ destinationDir })
  },
  setMirrorUrls: (mirrorUrls) => set({ mirrorUrls }),
  setQueue: (queue) => set({ queue }),
  setMediaCandidates: (mediaCandidates) => set({ mediaCandidates }),
  clearMediaCandidates: () => set({ mediaCandidates: [] })
}))
