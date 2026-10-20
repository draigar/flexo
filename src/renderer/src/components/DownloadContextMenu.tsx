import { Fragment } from 'react'
import { availableActions, type DownloadItem } from '../utils/downloadActions'
import { useDownloadActions } from './downloadActionsContext'
import { ACTION_META, menuLabel } from './downloadActionMeta'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from './ui/context-menu'

export function DownloadContextMenu({
  item,
  selected,
  chosen,
  children
}: {
  item: DownloadItem
  selected: boolean
  chosen: DownloadItem[]
  children: React.ReactNode
}): React.JSX.Element {
  const { perform } = useDownloadActions()
  const groups = availableActions(selected ? chosen : [item])
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">
        {groups.map((group, index) => (
          <Fragment key={group[0].id}>
            {index > 0 && <ContextMenuSeparator />}
            {group.map(({ id, targets }, position) => {
              const meta = ACTION_META[id]
              return (
                <ContextMenuItem
                  key={id}
                  variant={meta.destructive ? 'destructive' : 'default'}
                  className={index === 0 && position === 0 ? 'font-medium' : undefined}
                  onClick={() => void perform(id, targets)}
                >
                  <meta.icon aria-hidden />
                  {menuLabel(id, targets)}
                </ContextMenuItem>
              )
            })}
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}
