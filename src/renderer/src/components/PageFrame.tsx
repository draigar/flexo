import { useAppStore } from '../store/useAppStore'
import { Button } from './ui/button'

export function PageFrame({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  const setPage = useAppStore((store) => store.setPage)

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-2 px-5 pt-4 pb-3">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setPage('home')}
          className="font-mono text-[10px] tracking-wide uppercase"
        >
          Back
        </Button>
        <h1 className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
          {title}
        </h1>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
    </div>
  )
}
