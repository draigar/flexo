import type {
  ChunkState,
  DownloadNetwork,
  DownloadState,
  FinishedDownload,
  HttpDownloadNetwork,
  HttpDownloadState,
  NetworkInterfaceKind,
  SpeedUnit,
  TorrentDownloadNetwork,
  TorrentDownloadState
} from '@shared/types'
import { describeError } from '@shared/errors'

export { describeError }

export type DownloadItem = DownloadState | FinishedDownload

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let exponent = Math.max(
    0,
    Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  )
  let value = bytes / 1024 ** exponent
  if (exponent < UNITS.length - 1 && Number(value.toFixed(exponent === 0 ? 0 : 1)) >= 1024) {
    exponent += 1
    value = bytes / 1024 ** exponent
  }
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${UNITS[exponent]}`
}

const BIT_UNITS = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps']

export function formatSpeed(bytesPerSec: number, unit: SpeedUnit = 'bytes'): string {
  if (unit === 'bytes') return `${formatBytes(bytesPerSec)}/s`
  const bits = Number.isFinite(bytesPerSec) && bytesPerSec > 0 ? bytesPerSec * 8 : 0
  let exponent = bits < 1 ? 0 : Math.min(Math.floor(Math.log10(bits) / 3), BIT_UNITS.length - 1)
  const digits = (value: number): number => (exponent === 0 || value >= 99.95 ? 0 : 1)
  let value = bits / 1000 ** exponent
  if (exponent < BIT_UNITS.length - 1 && Number(value.toFixed(digits(value))) >= 1000) {
    exponent += 1
    value = bits / 1000 ** exponent
  }
  return `${value.toFixed(digits(value))} ${BIT_UNITS[exponent]}`
}

const SPEED_UNIT_BYTES: Record<string, number> = {
  'B/s': 1,
  'KB/s': 1024,
  'MB/s': 1024 ** 2,
  'GB/s': 1024 ** 3,
  'TB/s': 1024 ** 4,
  bps: 1 / 8,
  Kbps: 1e3 / 8,
  Mbps: 1e6 / 8,
  Gbps: 1e9 / 8,
  Tbps: 1e12 / 8
}

export function speedTicks(
  max: number,
  unit: SpeedUnit
): { top: number; ticks: { value: number; label: string }[] } {
  if (!(max > 0)) return { top: 1, ticks: [] }
  const label = formatSpeed(max, unit).split(' ')[1]
  const size = SPEED_UNIT_BYTES[label] || 1
  const third = max / size / 3
  const power = 10 ** Math.floor(Math.log10(third || 1))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= third) || 1
  const count = Math.ceil(max / size / step)
  const ticks = Array.from({ length: count }, (_, i) => {
    const value = Number(((i + 1) * step).toFixed(2))
    return { value: value * size, label: `${value} ${label}` }
  })
  return { top: count * step * size, ticks }
}

export function formatSetSpeed(bytesPerSec: number, unit: SpeedUnit): string {
  const formatted = formatSpeed(bytesPerSec, unit)
  return formatted.replace(/\.0\s/, ' ')
}

export function formatSpeedLimit(bytesPerSec: number, unit: SpeedUnit): string {
  const [value, label] = formatSpeed(bytesPerSec, unit).split(' ')
  const number = Number(value)
  return `${number >= 10 ? Math.round(number) : number} ${label}`
}

export function formatDataUsage(used: number, limit: number): string {
  const max = formatBytes(limit).replace('.0 ', ' ')
  const [rounded, unit] = formatBytes(used).split(' ')
  const exponent = UNITS.indexOf(unit)
  const value =
    exponent === 0 ? rounded : (Math.floor((used / 1024 ** exponent) * 10) / 10).toFixed(1)
  return max.endsWith(` ${unit}`) ? `${value} of ${max}` : `${value} ${unit} of ${max}`
}

export function formatSpeedOfLimit(
  bytesPerSec: number,
  limit: number,
  unit: SpeedUnit
): [string, string] {
  const max = formatSpeedLimit(limit, unit)
  if (bytesPerSec <= 0) return ['—', max]
  const speed = formatSpeed(bytesPerSec, unit)
  const [value, speedUnit] = speed.split(' ')
  return [max.endsWith(` ${speedUnit}`) ? value : speed, max]
}

export function formatEta(secondsOrRemaining: number, bytesPerSec?: number): string {
  const seconds =
    bytesPerSec !== undefined
      ? bytesPerSec > 0
        ? secondsOrRemaining / bytesPerSec
        : 0
      : secondsOrRemaining
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  if (Math.ceil(seconds) < 60) return `${Math.max(1, Math.ceil(seconds))}s`
  const totalSec = Math.max(60, Math.round(seconds))
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  if (mins < 60) return `${mins}m ${secs}s`
  const hrs = Math.floor(mins / 60)
  const remMins = mins % 60
  return `${hrs}h ${remMins}m`
}

export function formatPercent(bytesDownloaded: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0
  return Math.min(100, Math.round((bytesDownloaded / totalBytes) * 100))
}

export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export function fileExtensionBadge(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return 'FILE'
  return fileName.slice(dotIndex + 1, dotIndex + 5).toUpperCase()
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const total = Math.max(0, Math.round(seconds))
  const hrs = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export function splitFormattedBytes(bytes: number): { value: string; unit: string } {
  const [value, unit] = formatBytes(bytes).split(' ')
  return { value, unit }
}

export function dirnameOf(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (index < 0) return '.'
  if (index === 0 || (index === 2 && path[1] === ':')) return path.slice(0, index + 1)
  return path.slice(0, index)
}

export function pathInTorrent(path: string): string {
  return path.split(/[\\/]/).slice(1).join('/') || path
}

export function formatWhen(time: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - time) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const date = new Date(time)
  const clock = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const days = Math.round(
    (new Date(now).setHours(0, 0, 0, 0) - new Date(time).setHours(0, 0, 0, 0)) / 86_400_000
  )
  if (days === 0) return `Today ${clock}`
  if (days === 1) return `Yesterday ${clock}`
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function acceptedLink(text: string): string | null {
  const link = text.trim()
  if (/^(https?:\/\/|magnet:\?)/i.test(link)) return link
  if (/^(\/|[a-z]:\\).*\.torrent$/i.test(link)) return link
  return null
}

export function sourceOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function isFolder(item: DownloadItem): boolean {
  return item.kind === 'torrent' && 'folder' in item && !!item.folder
}

export function wantedBytes(item: DownloadItem): number {
  return item.totalBytes
}

export function describeFileCount(chosenOrCount: number, total?: number): string {
  if (total !== undefined) {
    const files = `${total} ${total === 1 ? 'file' : 'files'}`
    return chosenOrCount === total ? files : `${chosenOrCount} of ${files}`
  }
  return chosenOrCount === 1 ? '1 file' : `${chosenOrCount} files`
}

export function toDisplayPath(path: string, homeDir: string): string {
  const normalize = (value: string): string => {
    const normalized = value.replace(/\\/g, '/').replace(/\/$/, '')
    return /^[a-z]:/i.test(normalized) || normalized.startsWith('//')
      ? normalized.toLowerCase()
      : normalized
  }
  const home = normalize(homeDir)
  const target = normalize(path)
  if (home && (target === home || target.startsWith(`${home}/`))) {
    return `~${path.slice(home.length)}`
  }
  return path
}

const LINK_REFUSED = /status (401|403|404|410|416) for range request/

export function linkExpired(download: DownloadState): boolean {
  return (
    download.kind === 'http' &&
    download.status === 'error' &&
    LINK_REFUSED.test(download.error ?? '')
  )
}

export interface HttpNetworkGroup extends HttpDownloadNetwork {
  streams: HttpDownloadState['streams']
}

export interface TorrentNetworkGroup extends TorrentDownloadNetwork {
  peers: TorrentDownloadState['peers']
}

export type NetworkGroup = HttpNetworkGroup | TorrentNetworkGroup

export function groupByNetwork(download: DownloadState): NetworkGroup[] {
  if (download.kind === 'http') {
    const networks = download.networks ?? []
    const streams = download.streams ?? download.chunks ?? []
    return networks.map((network) => ({
      ...network,
      streams: streams.filter((stream) => stream.interfaceId === network.id)
    }))
  }
  const networks = download.networks ?? []
  const peers = download.peers ?? []
  return networks.map((network) => ({
    ...network,
    peers: peers.filter((peer) => peer.interfaceId === network.id)
  }))
}

export function networksInPlay<T extends DownloadNetwork>(networks: T[]): T[] {
  return networks.filter((network) => network.enabled || network.bytesDownloaded > 0)
}

export function networkActive(group: NetworkGroup): boolean {
  return group.transfer === 'http'
    ? group.streams.some((stream) => stream.status === 'downloading')
    : group.peers.some((peer) => peer.status === 'receiving')
}

export interface ChunkNetworkGroup {
  interfaceId: string
  interfaceLabel: string
  interfaceKind: NetworkInterfaceKind
  chunks: ChunkState[]
  bytesDownloaded: number
  speedBytesPerSec: number
}

export function groupChunksByInterface(chunks: ChunkState[]): ChunkNetworkGroup[] {
  const order: string[] = []
  const groups = new Map<string, ChunkNetworkGroup>()

  for (const chunk of chunks) {
    let group = groups.get(chunk.interfaceId)
    if (!group) {
      group = {
        interfaceId: chunk.interfaceId,
        interfaceLabel: chunk.interfaceId,
        interfaceKind: 'other',
        chunks: [],
        bytesDownloaded: 0,
        speedBytesPerSec: 0
      }
      groups.set(chunk.interfaceId, group)
      order.push(chunk.interfaceId)
    }
    group.chunks.push(chunk)
    group.bytesDownloaded += chunk.bytesDownloaded
    group.speedBytesPerSec += chunk.speedBytesPerSec
  }

  return order.map((interfaceId) => groups.get(interfaceId)!)
}

export function normalizeDownloadState(raw: any): DownloadState {
  if (!raw) return raw
  const kind = raw.kind ?? 'http'
  const chunks = Array.isArray(raw.chunks) ? raw.chunks : []
  const blocks = Array.isArray(raw.blocks) ? raw.blocks : []

  let networks = raw.networks
  if (!networks || !Array.isArray(networks) || networks.length === 0) {
    const chunkGroups = groupChunksByInterface(chunks)
    networks = chunkGroups.map((cg) => {
      const active = cg.chunks.some((c: any) => c.status === 'downloading')
      const anyError = cg.chunks.find((c: any) => c.error)?.error
      const status = anyError ? 'unreachable' : active ? 'on' : 'off'
      return {
        id: cg.interfaceId,
        label: cg.interfaceLabel || cg.interfaceId,
        kind: cg.interfaceKind || 'other',
        enabled: true,
        status,
        error: anyError,
        bytesDownloaded: cg.bytesDownloaded,
        speedBytesPerSec: cg.speedBytesPerSec,
        retries: cg.chunks.reduce((sum: number, c: any) => sum + (c.retryCount ?? 0), 0),
        transfer: 'http' as const
      }
    })
    if (networks.length === 0) {
      networks = [
        {
          id: 'default',
          label: 'Default',
          kind: 'other' as const,
          enabled: true,
          status: (raw.status === 'downloading' ? 'on' : 'off') as any,
          bytesDownloaded: raw.bytesDownloaded ?? 0,
          speedBytesPerSec: raw.speedBytesPerSec ?? 0,
          retries: 0,
          transfer: 'http' as const
        }
      ]
    }
  }

  const streams = Array.isArray(raw.streams) ? raw.streams : chunks

  return {
    ...raw,
    kind,
    networks,
    streams,
    chunks: streams,
    blocks,
    totalBlocks: raw.totalBlocks ?? blocks.length,
    blockSizeBytes: raw.blockSizeBytes ?? 0,
    peakStreams: raw.peakStreams ?? chunks.length,
    pieces: raw.pieces ?? [],
    peers: raw.peers ?? [],
    totalPieces: raw.totalPieces ?? 0,
    pieceLength: raw.pieceLength ?? 0,
    files: raw.files ?? { chosen: 1, total: 1 },
    skippedBytes: raw.skippedBytes ?? 0,
    bytesUploaded: raw.bytesUploaded ?? 0,
    uploadSpeedBytesPerSec: raw.uploadSpeedBytesPerSec ?? 0,
    peakPeers: raw.peakPeers ?? 0,
    infoHash: raw.infoHash ?? ''
  } as DownloadState
}
