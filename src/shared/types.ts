export type NetworkInterfaceKind = 'wifi' | 'usb' | 'ethernet' | 'bridge' | 'other'
export type IpFamily = 4 | 6

export interface NetworkAddress {
  address: string
  family: IpFamily
  netmask?: string
  /** Used by the existing IPv4 same-subnet warning. */
  subnet?: string
}

export type ThemeSource = 'light' | 'dark'

export interface NetworkInterfaceInfo {
  /** Stable identifier for this interface (currently the OS device name, e.g. "en0"). */
  id: string
  device: string
  displayName: string
  addresses: NetworkAddress[]
  kind: NetworkInterfaceKind
  mac?: string
}

export interface ProbeResult {
  requestedUrl: string
  /** URL after following redirects — this is what the download should actually fetch. */
  finalUrl: string
  supportsRanges: boolean
  /** null when the server did not report a size. */
  totalBytes: number | null
  suggestedFileName: string
  contentType: string | null
  /** Strong validators, used to detect if the remote content changes between pause and resume. */
  etag: string | null
  lastModified: string | null
}

export type DownloadStatus =
  'downloading' | 'assembling' | 'paused' | 'completed' | 'error' | 'cancelled'

/** A stream's state. `pending` means it is waiting for work: it holds no block, either because
 * none is free for it right now or because it hasn't started. `downloading` always means it is
 * fetching one (`currentBlockIndex` says which). */
export type ChunkStatus =
  'pending' | 'downloading' | 'retrying' | 'paused' | 'completed' | 'error' | 'cancelled'

export interface ChunkState {
  id: number
  interfaceId: string
  interfaceLabel: string
  interfaceKind: NetworkInterfaceKind
  rangeStart: number
  /** null means an open-ended range (download to end of file). */
  rangeEnd: number | null
  bytesDownloaded: number
  speedBytesPerSec: number
  status: ChunkStatus
  error?: string
  /** Number of times this chunk's connection has been retried after a dropped/failed attempt. */
  retryCount: number
  /** The block this stream is fetching. Unset whenever it holds none (idle, retrying, paused, done). */
  currentBlockIndex?: number
  /** True while this stream is racing another stream for `currentBlockIndex`, because that one
   * was too slow — see main/download/scheduler.ts. Whichever finishes first wins. */
  hedge?: boolean
}

export type BlockStatus = 'pending' | 'downloading' | 'completed' | 'error'

export interface BlockState {
  index: number
  rangeStart: number
  rangeEnd: number | null
  status: BlockStatus
  /** The network currently leasing this block (or the last one to touch it). Only meaningful
   * as "who is working on it now" — for who actually *delivered* the bytes, read
   * `bytesByInterface`, since a block can be started on one network and finished on another
   * after a retry or a pause/resume. */
  interfaceId?: string
  bytesDownloaded: number
  /** Bytes of this block delivered by each network, keyed by interface id. Summing to
   * `bytesDownloaded`, this is what the block grid colors by, so a block split across
   * networks is attributed to all of them instead of only the one that happened to finish it. */
  bytesByInterface: Record<string, number>
}

export interface DownloadState {
  id: string
  url: string
  fileName: string
  destinationPath: string
  /** 0 means the size could not be determined ahead of time. */
  totalBytes: number
  bytesDownloaded: number
  speedBytesPerSec: number
  status: DownloadStatus
  chunks: ChunkState[]
  blocks?: BlockState[]
  totalBlocks?: number
  blockSizeBytes?: number
  error?: string
  startedAt: number
  pausedAt?: number
  totalPausedMs?: number
  completedAt?: number
  /** Bytes written to the destination file so far while `status` is 'assembling' — the part
   * files are already all complete at that point, so this tracks the sequential reassembly step
   * rather than the network transfer. */
  assembledBytes?: number
}

/** User customization for one physical network, keyed by NetworkInterfaceInfo.id — lets a
 * cryptic OS device name (e.g. "feth0") get a real label, and a color distinct from its
 * kind's default. Persisted in the main process, independent of any single download. */
export interface NetworkPreference {
  customName?: string
  /** One of the app's curated swatch ids (see NETWORK_COLOR_SWATCHES) — not a raw hex, so every
   * swatch is guaranteed to have a legible on-solid text color already picked out for it. */
  colorId?: string
}

export type NetworkPreferences = Record<string, NetworkPreference>

/** One fake network in a dev-tool "virtual download" — see SimulatedNetworkConfig callers in
 * main/download/simDownload.ts. Lets a developer exercise the multi-network UI (the block grid,
 * per-network speed/throughput, retries, errors, assembling) against a file already on disk,
 * without needing a real flaky connection or a slow remote server to test against. */
export interface SimulatedNetworkConfig {
  kind: NetworkInterfaceKind
  label: string
  /** Target sustained throughput for this simulated network, in bytes/sec. */
  speedBytesPerSec: number
  /** 0-100 chance a chunk attempt on this network fails outright, simulating a dropped
   * connection — set above 0 to exercise the retry/error UI on demand. */
  faultRatePercent: number
}

export interface StartSimulatedDownloadRequest {
  /** Absolute path to a file already on disk — this is what gets "downloaded". */
  sourceFilePath: string
  destinationDir: string
  networks: SimulatedNetworkConfig[]
  chunkCount: number
  connectionsPerNetwork?: number
  /** Throttles the reassembly step to this many bytes/sec, so the 'assembling' phase's UI (the
   * block grid sweep, the combine diagram) stays visible long enough to watch even on a small
   * file that would otherwise reassemble in a single tick. Omitted or 0 assembles at full disk
   * speed, same as a real download. */
  assembleSpeedBytesPerSec?: number
}

export interface UpdateInfo {
  version: string
  /** Where clicking the notification should take the user — the landing page's downloads. */
  url: string
  /** True once the user has dismissed the banner for this exact version (persisted, so it stays
   * dismissed across relaunches) — the app then falls back to a quiet titlebar icon instead. */
  dismissed: boolean
}

/** What app-settings.json holds, and what the renderer sends to change it (merged over the saved
 * values, `undefined` clearing one). A missing field was never set. */
/** Segment size preset. `auto` picks 32 MB for similar networks and 8 MB for mixed kinds. */
export type SegmentPreset = 'auto' | '8' | '16' | '32' | '64'

export interface AppSettings {
  themeSource?: ThemeSource
  dismissedUpdateVersion?: string
  streamsPerNetwork?: number
  /** The last destination folder picked. */
  destinationDir?: string
  /** User customizations (name/color) per network interface id. */
  networkPreferences?: NetworkPreferences
  /** Max block size preset for new downloads. */
  segmentPreset?: SegmentPreset
  /** Start a captured browser or deep-link file immediately. */
  autoDownload?: boolean
  /** Offer a copied http(s) or magnet link in the link field. */
  watchClipboard?: boolean
  /** Maximum concurrent active downloads (defaults to 6, up to 100). */
  maxConcurrentDownloads?: number
}

/** Everything the renderer needs for its first paint, read synchronously by the preload so no
 * saved value flashes in over a default a moment after launch. */
export interface InitialState {
  homeDir: string
  downloadsDir: string
  /** True while running under Vite in development — gates the dev tools panel. */
  isDev: boolean
  themeSource: ThemeSource
  networkPreferences: NetworkPreferences
  streamsPerNetwork?: number
  /** The last folder picked, if it still exists — otherwise the renderer uses downloadsDir. */
  destinationDir?: string
  segmentPreset?: SegmentPreset
  autoDownload: boolean
  watchClipboard: boolean
  maxConcurrentDownloads?: number
}

export interface DownloadRecord {
  id: string
  url: string
  fileName: string
  destinationPath: string
  totalBytes: number
  startedAt: number
  completedAt: number
}

export interface StartDownloadRequest {
  url: string
  destinationDir: string
  suggestedFileName: string
  /** 0 means unknown. */
  totalBytes: number
  supportsRanges: boolean
  interfaceIds: string[]
  /** Total chunks to split the download into across interfaceIds. */
  chunkCount: number
  /** Number of parallel connections allocated per physical network. */
  connectionsPerNetwork?: number
  etag: string | null
  lastModified: string | null
  /** Alternate URLs that serve the same bytes. */
  mirrorUrls?: string[]
  /** Overrides the planner's max block size for this download. */
  maxBlockBytes?: number
}

export type QueueItemStatus = 'waiting' | 'ready'

export interface QueueItem {
  id: string
  url: string
  fileName: string
  status: QueueItemStatus
  addedAt: number
  request: StartDownloadRequest
}

export type MediaKind = 'progressive' | 'hls' | 'dash' | 'page'

export interface MediaCandidate {
  id: string
  url: string
  title?: string
  kind: MediaKind
  quality?: string
  mimeType?: string
  totalBytes?: number | null
  /** True when a DRM system is required — Flexo will not download these. */
  drm: boolean
  unsupportedReason?: string
}

export interface InterfaceSpeedInfo {
  interfaceId: string
  device: string
  displayName: string
  kind: NetworkInterfaceKind
  address: string
  downloadBytesPerSec: number
  uploadBytesPerSec: number
  latencyMs?: number
  isActiveProbe: boolean
  lastUpdatedMs: number
}

export interface NetworkSpeedSnapshot {
  interfaces: InterfaceSpeedInfo[]
  totalDownloadBytesPerSec: number
  totalUploadBytesPerSec: number
  timestampMs: number
}
