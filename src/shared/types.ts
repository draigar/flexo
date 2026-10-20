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

interface ProbeResultBase {
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

export interface HttpProbeResult extends ProbeResultBase {
  kind: 'http'
}

export interface TorrentProbeResult extends ProbeResultBase {
  kind: 'torrent'
  torrent: TorrentInfo
}

export type ProbeResult = HttpProbeResult | TorrentProbeResult

export interface TorrentInfo {
  infoHash: string
  pieceLength: number
  /** Where each file will be written, relative to the destination folder. */
  files: { path: string; length: number }[]
}

/** One of a torrent download's files, for listing them while it runs. */
export interface TorrentFileEntry {
  /** Relative to the destination folder. */
  path: string
  length: number
  /** Chosen to be downloaded. */
  chosen: boolean
}

/** `queued`: waiting for one of the downloads running at once to end. */
export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'assembling'
  | 'paused'
  | 'completed'
  | 'error'
  | 'cancelled'

export type HttpStreamStatus =
  | 'pending'
  | 'downloading'
  | 'retrying'
  | 'paused'
  | 'completed'
  | 'cancelled'

/** Backward compatibility alias for ChunkStatus */
export type ChunkStatus = HttpStreamStatus

/** One connection to the server, through one network. */
export interface HttpStreamState {
  id: number
  interfaceId: string
  rangeStart: number
  rangeEnd: number | null
  bytesDownloaded: number
  speedBytesPerSec: number
  status: HttpStreamStatus
  currentBlockIndex?: number
  hedge?: boolean
  error?: string
  retryCount?: number
}

/** Compatibility alias for ChunkState */
export type ChunkState = HttpStreamState

export interface TorrentPeerState {
  id: number
  interfaceId: string
  status: 'connected' | 'receiving'
  client: string | null
  bytesDownloaded: number
  speedBytesPerSec: number
  bytesUploaded: number
  uploadSpeedBytesPerSec: number
}

export type HttpBlockStatus = 'pending' | 'downloading' | 'completed' | 'error'
export type TorrentPieceStatus = HttpBlockStatus | 'skipped'
export type BlockStatus = HttpBlockStatus

interface WorkUnitState {
  index: number
  rangeStart: number
  rangeEnd: number | null
  interfaceId?: string
  bytesDownloaded: number
  bytesByInterface: Record<string, number>
}

export interface HttpBlockState extends WorkUnitState {
  status: HttpBlockStatus
}

export interface TorrentPieceState extends WorkUnitState {
  status: TorrentPieceStatus
}

export type BlockState = HttpBlockState

export type NetworkStatus = 'on' | 'off' | 'offline' | 'unreachable' | 'failed' | 'limit'

interface DownloadNetworkBase {
  id: string
  label: string
  kind: NetworkInterfaceKind
  enabled: boolean
  status: NetworkStatus
  error?: string
  bytesDownloaded: number
  speedBytesPerSec: number
  retries: number
}

export interface HttpDownloadNetwork extends DownloadNetworkBase {
  transfer: 'http'
}

export interface TorrentDownloadNetwork extends DownloadNetworkBase {
  transfer: 'torrent'
  bytesUploaded: number
  uploadSpeedBytesPerSec: number
}

export type DownloadNetwork = HttpDownloadNetwork | TorrentDownloadNetwork

export interface BaseDownloadState {
  id: string
  url: string
  fileName: string
  destinationPath: string
  finalUrl?: string
  totalBytes: number
  bytesDownloaded: number
  speedBytesPerSec: number
  timeLeftSeconds?: number
  status: DownloadStatus
  error?: string
  resumable?: boolean
  startedAt: number
  scheduled?: boolean
  queuedAt?: number
  pausedAt?: number
  totalPausedMs?: number
  completedAt?: number
  speedHistory?: Record<string, number[]> | number[]
  peakSpeedBytesPerSec?: number
  seq?: number
  assembledBytes?: number
  streamsPerNetwork?: number
}

export interface HttpDownloadState extends BaseDownloadState {
  kind: 'http'
  networks: HttpDownloadNetwork[]
  streams: HttpStreamState[]
  peakStreams: number
  chunks: HttpStreamState[]
  blocks: HttpBlockState[]
  totalBlocks: number
  blockSizeBytes: number
  supportsRanges?: boolean
  diskLimited?: boolean
  fromBrowser?: string
  speedHistory?: Record<string, number[]>
}

export interface TorrentDownloadState extends BaseDownloadState {
  kind: 'torrent'
  networks: TorrentDownloadNetwork[]
  peers: TorrentPeerState[]
  peakPeers: number
  pieces: TorrentPieceState[]
  totalPieces: number
  pieceLength: number
  files: { chosen: number; total: number; selected?: number[] }
  folder: boolean
  skippedBytes: number
  bytesUploaded: number
  uploadSpeedBytesPerSec: number
  infoHash: string
  speedHistory?: Record<string, number[]>
}

export type DownloadState = HttpDownloadState | TorrentDownloadState

export type FinishedDownload = (
  | Omit<HttpDownloadState, 'blocks' | 'streams' | 'chunks'>
  | Omit<TorrentDownloadState, 'pieces' | 'peers'>
) & {
  unitsWritten: number
  missing?: boolean
  downloadedFiles?: string[]
}

export type HttpDownloadUpdate = {
  seq: number
  state: HttpDownloadState
  blocks: HttpBlockState[]
}

export type TorrentDownloadUpdate = {
  seq: number
  state: TorrentDownloadState
  pieces: TorrentPieceState[]
}

export type DownloadUpdate = HttpDownloadUpdate | TorrentDownloadUpdate

export type DataLimitPeriod = 'day' | 'week' | 'month'

export interface NetworkPreference {
  displayName?: string
  customName?: string
  name?: string
  color?: string
  colorId?: string
  off?: boolean
  speedLimit?: number
  dataLimit?: number
  dataLimitPeriod?: DataLimitPeriod
}

export type NetworkPreferences = Record<string, NetworkPreference>

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
  autoUpdate: boolean
  version?: string
  percent?: number
}

export interface UpdateInfo {
  version: string
  url: string
  dismissed: boolean
}

export interface DownloadSchedule {
  enabled: boolean
  startMinute: number
  endMinute: number
  days: number[]
  endDate?: string
}

export type SpeedUnit = 'bytes' | 'bits'

export const DOWNLOADS_AT_ONCE = { default: 2, min: 1, max: 4 }
export const SPEED_HISTORY_SECONDS = 60
export const DEFAULT_SLOW_MODE_SPEED = 2 * 1024 ** 2

export interface AppSettings {
  downloadSchedule?: DownloadSchedule
  themeSource?: ThemeSource
  autoUpdate?: boolean
  destinationDir?: string
  networkPreferences?: NetworkPreferences
  downloadsAtOnce?: number
  speedLimit?: number
  slowMode?: boolean
  slowModeSpeed?: number
  speedUnit?: SpeedUnit
  browserExtensionUsed?: boolean
  streamsPerNetwork?: number
  segmentPreset?: SegmentPreset
  autoDownload?: boolean
  watchClipboard?: boolean
  maxConcurrentDownloads?: number
  dismissedUpdateVersion?: string
}

export interface InitialState {
  downloadSchedule?: DownloadSchedule
  homeDir: string
  downloadsDir: string
  isDev?: boolean
  themeSource: ThemeSource
  networkPreferences: NetworkPreferences
  downloadsAtOnce: number
  speedLimit?: number
  slowMode: boolean
  slowModeSpeed: number
  speedUnit: SpeedUnit
  destinationDir?: string
  streamsPerNetwork?: number
  segmentPreset?: SegmentPreset
  autoDownload?: boolean
  watchClipboard?: boolean
  maxConcurrentDownloads?: number
}

interface StartDownloadRequestBase {
  url: string
  destinationDir: string
  suggestedFileName: string
  totalBytes: number
  supportsRanges: boolean
  interfaceIds: string[]
  etag: string | null
  lastModified: string | null
}

export interface StartHttpDownloadRequest extends StartDownloadRequestBase {
  kind: 'http'
  streamsPerNetwork?: number
  chunkCount?: number
  connectionsPerNetwork?: number
  maxBlockBytes?: number
  mirrorUrls?: string[]
  browser?: BrowserContext
  referer?: string
  cookies?: string
  userAgent?: string
}

export type ProbeUrlPayload =
  | string
  | {
      url: string
      referer?: string
      cookies?: string
      userAgent?: string
    }

export interface BrowserCookie {
  name: string
  value: string
  domain: string
  hostOnly: boolean
  path: string
  secure: boolean
}

export interface BrowserContext {
  cookies: BrowserCookie[]
  referer?: string
  userAgent?: string
  name?: string
}

export interface PendingLink {
  id: string
  url: string
  probe?: ProbeResult
  from?: string
  signedInTo?: string
  resumes?: { id: string; fileName: string }
}

export interface StartTorrentDownloadRequest extends StartDownloadRequestBase {
  kind: 'torrent'
  infoHash: string
  selectedFiles?: number[]
}

export type StartDownloadRequest = StartHttpDownloadRequest | StartTorrentDownloadRequest

/* Flexo media & speed probe types */
export type MediaKind = 'progressive' | 'hls' | 'dash' | 'page'

export interface MediaCandidate {
  id: string
  url: string
  title?: string
  kind: MediaKind
  quality?: string
  mimeType?: string
  totalBytes?: number | null
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

export interface SimulatedNetworkConfig {
  id?: string
  name?: string
  kind: NetworkInterfaceKind
  label?: string
  speedLimitBytesPerSec?: number
  speedBytesPerSec?: number
  latencyMs?: number
  packetLossPercent?: number
  faultRatePercent?: number
}

export interface StartSimulatedDownloadRequest {
  sourceFilePath: string
  destinationDir: string
  fileName?: string
  networks?: SimulatedNetworkConfig[]
  chunkCount?: number
  connectionsPerNetwork?: number
  assembleSpeedBytesPerSec?: number
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

export type SegmentPreset =
  | 'aggressive'
  | 'balanced'
  | 'conservative'
  | 'auto'
  | '8'
  | '16'
  | '32'
  | '64'

export type QueueItemStatus = 'waiting' | 'ready'

export interface QueueItem {
  id: string
  url: string
  fileName: string
  status: QueueItemStatus
  addedAt: number
  request: StartDownloadRequest
}
