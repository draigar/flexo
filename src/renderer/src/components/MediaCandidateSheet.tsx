import type { MediaCandidate } from '@shared/types'
import { Film, ShieldAlert } from 'lucide-react'
import { Button } from './ui/button'
import { useAppStore } from '../store/useAppStore'
import { formatBytes } from '../utils/format'

export function MediaCandidateSheet({
  onPick
}: {
  onPick: (candidate: MediaCandidate) => void
}): React.JSX.Element | null {
  const candidates = useAppStore((store) => store.mediaCandidates)
  const clearMediaCandidates = useAppStore((store) => store.clearMediaCandidates)

  if (candidates.length === 0) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-4 backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          <Film className="size-3.5" />
          Media found
        </div>
        <Button type="button" variant="ghost" size="xs" onClick={clearMediaCandidates}>
          Dismiss
        </Button>
      </div>
      <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
        {candidates.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            disabled={candidate.drm}
            onClick={() => onPick(candidate)}
            className="flex items-center gap-3 rounded-[9px] border border-border px-3 py-2 text-left transition hover:bg-[var(--bg-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[12.5px] text-foreground">
                {candidate.title || candidate.quality || candidate.kind}
              </div>
              <div className="truncate font-mono text-[10.5px] text-muted-foreground">
                {candidate.kind}
                {candidate.mimeType ? ` · ${candidate.mimeType}` : ''}
                {candidate.totalBytes != null ? ` · ${formatBytes(candidate.totalBytes)}` : ''}
              </div>
              {candidate.drm && (
                <div className="mt-1 flex items-center gap-1 font-mono text-[10px] text-[var(--color-warning-text)]">
                  <ShieldAlert className="size-3" />
                  {candidate.unsupportedReason || 'DRM protected — not supported'}
                </div>
              )}
            </div>
            {!candidate.drm && (
              <span className="shrink-0 font-mono text-[11px] text-foreground">Download</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
