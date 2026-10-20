import { applyDownloadUpdate } from '@shared/downloadUpdate'
import type {
  AppSettings,
  DownloadSchedule,
  DownloadState,
  DownloadUpdate,
  FinishedDownload,
  MediaCandidate,
  NetworkInterfaceInfo,
  NetworkPreference,
  NetworkPreferences,
  NetworkSpeedSnapshot,
  PendingLink,
  QueueItem,
  SegmentPreset,
  SpeedUnit,
  ThemeSource,
  UpdateInfo
} from '@shared/types'
import { create } from 'zustand'
import { groupChunksByInterface, normalizeDownloadState } from '../utils/format'

export type DownloadFilter = 'all' | 'progress' | 'finished' | 'failed'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export type View = { name: 'list' } | { name: 'download'; id: string }

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
  maxConcurrentDownloads: number
  page: 'home' | 'settings' | 'library' | 'ongoing'

  availableUpdate: UpdateInfo | null

  homeDir: string
  downloadsDir: string
  isDev: boolean

  downloads: Record<string, DownloadState>
  activeDownloads: Record<string, DownloadState>
  history: FinishedDownload[]
  view: View
  downloadFilter: DownloadFilter
  setDownloadFilter: (filter: DownloadFilter) => void
  downloadSchedule: DownloadSchedule | undefined
  newDownloadOpen: boolean
  downloadsAtOnce: number
  speedLimit: number | undefined
  slowMode: boolean
  slowModeSpeed: number
  speedUnit: SpeedUnit

  draftUrl: string
  draftFileName?: string
  draftReferer?: string
  draftCookies?: string
  links: PendingLink[]
  shownId: string | null
  formKey: number
  startedUrl: string
  destinationDir: string
  captureError: string | null
  mirrorUrls: string[]

  focusedDownloadId: string | null
  currentDownload: DownloadState | null
  queue: QueueItem[]
  mediaCandidates: MediaCandidate[]
  speedHistory: number[]
  speedHistoryByInterface: Record<string, number[]>
  peakSpeedBytesPerSec: number

  networkSpeeds: NetworkSpeedSnapshot | null
  isTestingSpeed: boolean

  loadInterfaces: () => Promise<void>
  receiveInterfaces: (interfaces: NetworkInterfaceInfo[]) => void
  refreshLatencies: () => Promise<void>
  setNetworkPreference: (id: string, patch: NetworkPreference) => void
  setThemeSource: (source: ThemeSource) => void
  setStreamsPerNetwork: (streamsPerNetwork: number) => void
  setSegmentPreset: (segmentPreset: SegmentPreset) => void
  setAutoDownload: (autoDownload: boolean) => void
  setWatchClipboard: (watchClipboard: boolean) => void
  setMaxConcurrentDownloads: (maxConcurrentDownloads: number) => void
  setPage: (page: 'home' | 'settings' | 'library' | 'ongoing') => void

  receiveDownloadUpdate: (update: DownloadUpdate | DownloadState) => void
  receiveHistory: (history: FinishedDownload[]) => void
  forgetDownload: (id: string) => void
  clearHistory: () => void
  setView: (view: View) => void
  openNewDownload: (
    link?: string,
    fileName?: string,
    referer?: string,
    cookies?: string
  ) => void
  setDraftReferer: (referer: string | undefined) => void
  setDraftCookies: (cookies: string | undefined) => void
  closeNewDownload: () => void
  receiveLinks: () => Promise<void>
  showLink: (id: string) => void
  finishLink: (id: string, started: boolean) => void
  dropLink: (id: string, started: boolean) => void
  setDownloadsAtOnce: (count: number) => void
  setSpeedLimit: (bytesPerSec: number | undefined) => void
  setSlowMode: (on: boolean) => void
  setSlowModeSpeed: (bytesPerSec: number) => void
  setSpeedUnit: (unit: SpeedUnit) => void

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
  setNetworkSpeeds: (snapshot: NetworkSpeedSnapshot) => void
  triggerSpeedTest: () => Promise<void>
}

const initial = window.flexo.initialState

function persist(patch: AppSettings): void {
  window.flexo.updateSettings(patch).catch(() => {})
}

const letGo = new Set<string>()

export const useAppStore = create<AppStore>((set, get) => ({
  interfaces: [],
  interfacesStatus: 'idle',
  interfacesError: null,
  latencies: {},
  networkPreferences: initial.networkPreferences ?? {},

  themeSource: initial.themeSource ?? 'dark',
  streamsPerNetwork: initial.streamsPerNetwork ?? 2,
  segmentPreset: initial.segmentPreset ?? 'auto',
  autoDownload: initial.autoDownload ?? true,
  watchClipboard: initial.watchClipboard ?? true,
  maxConcurrentDownloads: initial.maxConcurrentDownloads ?? 6,
  page: 'home',

  availableUpdate: null,

  homeDir: initial.homeDir ?? '',
  downloadsDir: initial.downloadsDir ?? '',
  isDev: initial.isDev ?? false,

  downloads: {},
  activeDownloads: {},
  history: [],
  view: { name: 'list' },
  downloadFilter: 'all',
  setDownloadFilter: (downloadFilter) => set({ downloadFilter }),
  downloadSchedule: initial.downloadSchedule,
  newDownloadOpen: false,
  downloadsAtOnce: initial.downloadsAtOnce ?? 2,
  speedLimit: initial.speedLimit,
  slowMode: initial.slowMode ?? false,
  slowModeSpeed: initial.slowModeSpeed ?? 2 * 1024 ** 2,
  speedUnit: initial.speedUnit ?? 'bytes',

  draftUrl: '',
  draftFileName: undefined,
  draftReferer: undefined,
  draftCookies: undefined,
  links: [],
  shownId: null,
  formKey: 0,
  startedUrl: '',
  destinationDir: initial.destinationDir ?? initial.downloadsDir ?? '',
  captureError: null,
  mirrorUrls: [],

  focusedDownloadId: null,
  currentDownload: null,
  queue: [],
  mediaCandidates: [],
  speedHistory: [],
  speedHistoryByInterface: {},
  peakSpeedBytesPerSec: 0,

  networkSpeeds: null,
  isTestingSpeed: false,

  loadInterfaces: async () => {
    if (get().interfacesStatus !== 'ready') set({ interfacesStatus: 'loading' })
    set({ interfacesError: null })
    try {
      const interfaces = await window.flexo.listInterfaces()
      get().receiveInterfaces(interfaces)
      void get().refreshLatencies()
    } catch (error) {
      set({
        interfacesStatus: 'error',
        interfacesError: error instanceof Error ? error.message : String(error)
      })
    }
  },

  receiveInterfaces: (interfaces) =>
    set({ interfaces, interfacesStatus: 'ready', interfacesError: null }),

  refreshLatencies: async () => {
    try {
      const latencies = await window.flexo.pingInterfaces()
      set({ latencies })
    } catch {
      // Ignored
    }
  },

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

  setMaxConcurrentDownloads: (maxConcurrentDownloads) => {
    set({ maxConcurrentDownloads })
    persist({ maxConcurrentDownloads })
  },

  setPage: (page) => set({ page }),

  receiveDownloadUpdate: (rawUpdate) => {
    const { downloads, history } = get()
    let download: DownloadState | null = null

    if ('state' in rawUpdate && 'seq' in rawUpdate) {
      if (history.some((entry) => entry.id === rawUpdate.state.id)) return
      const previous = downloads[rawUpdate.state.id] ?? null
      download = applyDownloadUpdate(previous, rawUpdate)
    } else {
      const state = rawUpdate as DownloadState
      if (history.some((entry) => entry.id === state.id)) return
      download = state
    }

    if (!download) return
    const normalized = normalizeDownloadState(download)
    const updatedDownloads = { ...downloads, [normalized.id]: normalized }
    set({ downloads: updatedDownloads, activeDownloads: updatedDownloads })
    get().setCurrentDownload(normalized)
  },

  receiveHistory: (history) => {
    const downloads = { ...get().downloads }
    for (const entry of history) delete downloads[entry.id]
    set({ history, downloads, activeDownloads: downloads })
  },

  forgetDownload: (id) => {
    const { [id]: removed, ...downloads } = get().downloads
    void removed
    set({
      downloads,
      activeDownloads: downloads,
      history: get().history.filter((entry) => entry.id !== id)
    })
    if (get().focusedDownloadId === id) {
      set({
        focusedDownloadId: null,
        currentDownload: null,
        speedHistory: [],
        speedHistoryByInterface: {},
        peakSpeedBytesPerSec: 0
      })
    }
  },

  clearHistory: () => {
    set({ history: [] })
  },

  setView: (view) => {
    set({ view })
    if (view.name === 'download') {
      get().setFocusedDownloadId(view.id)
    }
  },

  openNewDownload: (link, fileName, referer, cookies) =>
    set({
      newDownloadOpen: true,
      ...(link !== undefined ? { draftUrl: link } : {}),
      draftFileName: fileName,
      draftReferer: referer,
      draftCookies: cookies
    }),

  setDraftReferer: (draftReferer) => set({ draftReferer }),
  setDraftCookies: (draftCookies) => set({ draftCookies }),

  closeNewDownload: () => {
    const { links, shownId } = get()
    if (shownId) return get().finishLink(shownId, false)
    if (links.length > 0) return get().showLink(links[links.length - 1].id)
    set({ newDownloadOpen: false })
  },

  receiveLinks: async () => {
    // Links waiting from bridge
  },

  showLink: (id) => {
    const link = get().links.find((candidate) => candidate.id === id)
    if (link) set({ shownId: id, draftUrl: link.url, formKey: get().formKey + 1 })
  },

  finishLink: (id, started) => {
    const wasShown = get().shownId === id
    get().dropLink(id, started)
    if (!wasShown) return
    const left = get().links
    set({ draftUrl: '' })
    if (left.length > 0) get().showLink(left[left.length - 1].id)
    else set({ newDownloadOpen: false })
  },

  dropLink: (id, _started) => {
    const { links, shownId } = get()
    if (!links.some((link) => link.id === id)) return
    letGo.add(id)
    set({
      links: links.filter((link) => link.id !== id),
      ...(shownId === id && { shownId: null })
    })
  },

  setDownloadsAtOnce: (downloadsAtOnce) => {
    set({ downloadsAtOnce })
    persist({ downloadsAtOnce })
  },

  setSpeedLimit: (speedLimit) => {
    set({ speedLimit })
    persist({ speedLimit })
  },

  setSlowMode: (slowMode) => {
    set({ slowMode })
    persist({ slowMode })
  },

  setSlowModeSpeed: (slowModeSpeed) => {
    set({ slowModeSpeed })
    persist({ slowModeSpeed })
  },

  setSpeedUnit: (speedUnit) => {
    set({ speedUnit })
    persist({ speedUnit })
  },

  setFocusedDownloadId: (id) => {
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
    const download = get().downloads[id] ?? get().activeDownloads[id] ?? null
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
      const normalized = normalizeDownloadState(d)
      map[normalized.id] = normalized
    }
    const focusedId = get().focusedDownloadId
    const current = focusedId ? (map[focusedId] ?? null) : null
    set({
      downloads: map,
      activeDownloads: map,
      currentDownload: current
    })
  },

  removeActiveDownload: (id) => {
    get().forgetDownload(id)
  },

  checkForUpdate: async () => {
    try {
      const availableUpdate = await window.flexo.checkForUpdate()
      set({ availableUpdate })
    } catch {
      // Ignored
    }
  },

  dismissUpdate: () => {
    const update = get().availableUpdate
    if (update) {
      persist({ dismissedUpdateVersion: update.version })
      set({ availableUpdate: { ...update, dismissed: true } })
    }
  },

  setCurrentDownload: (rawDownload) => {
    const download = normalizeDownloadState(rawDownload)
    const activeDownloads = { ...get().activeDownloads, [download.id]: download }
    let focusedDownloadId = get().focusedDownloadId

    const currentFocused = focusedDownloadId ? get().activeDownloads[focusedDownloadId] : null
    const shouldAutoFocus =
      !focusedDownloadId ||
      currentFocused?.status === 'completed' ||
      currentFocused?.status === 'cancelled' ||
      currentFocused?.status === 'error'

    let pageUpdate: { page?: 'home' } = {}
    if (shouldAutoFocus && (download.status === 'downloading' || download.status === 'assembling')) {
      focusedDownloadId = download.id
      pageUpdate = { page: 'home' }
    }

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
        const chunks = 'chunks' in download && Array.isArray((download as any).chunks) ? (download as any).chunks : []
        for (const group of groupChunksByInterface(chunks)) {
          const previousSeries = speedHistoryByInterface[group.interfaceId] ?? []
          nextByInterface[group.interfaceId] = [...previousSeries, group.speedBytesPerSec].slice(
            -SPEED_HISTORY_LENGTH
          )
        }
        speedHistoryByInterface = nextByInterface
      }
    }

    set({
      ...pageUpdate,
      downloads: activeDownloads,
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
    if (focusedId) {
      get().forgetDownload(focusedId)
    }
    set({
      draftUrl: ''
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
  clearMediaCandidates: () => set({ mediaCandidates: [] }),

  setNetworkSpeeds: (networkSpeeds) => set({ networkSpeeds }),
  triggerSpeedTest: async () => {
    set({ isTestingSpeed: true })
    try {
      const snapshot = await window.flexo.triggerSpeedTest()
      set({ networkSpeeds: snapshot })
    } catch {
      // Ignored
    } finally {
      set({ isTestingSpeed: false })
    }
  }
}))
