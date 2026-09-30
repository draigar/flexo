import type { QueueItem } from '@shared/types'
import { ListOrdered, X } from 'lucide-react'
import { Button } from './ui/button'
import { useAppStore } from '../store/useAppStore'

export function QueueSheet(): React.JSX.Element | null {
  const queue = useAppStore((store) => store.queue)

  if (queue.length === 0) return null

  return (
    <div className="border-t border-border bg-[var(--bg-secondary)] px-5 py-3">
      <div className="mb-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
        <ListOrdered className="size-3.5" />
        Waiting ({queue.length})
      </div>
      <div className="flex flex-col gap-1.5">
        {queue.map((item) => (
          <QueueRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}

function QueueRow({ item }: { item: QueueItem }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 rounded-[9px] border border-border bg-background px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[12.5px] text-foreground">{item.fileName}</div>
        <div className="truncate font-mono text-[10.5px] text-muted-foreground">{item.url}</div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-label="Remove from queue"
        onClick={() => void window.flexo.removeDownload(item.id)}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
}
