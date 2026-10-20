import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { acceptedLink } from '../utils/format'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent)

export function useOpenedLinks(): void {
  const openNewDownload = useAppStore((store) => store.openNewDownload)

  useEffect(() => {
    const unlistenBridge = window.flexo.onBridgeAdd((request) => {
      const cookieHeader = request.browser?.cookies?.map((c) => `${c.name}=${c.value}`).join('; ')
      const referer = request.browser?.referer || request.pageUrl
      openNewDownload(request.url, request.fileName, referer, cookieHeader)
    })
    const unlistenClip = window.flexo.onClipboardUrl((url) => {
      openNewDownload(url)
    })
    return () => {
      unlistenBridge()
      unlistenClip()
    }
  }, [openNewDownload])
}

export function useNewDownloadShortcuts(): void {
  const openNewDownload = useAppStore((store) => store.openNewDownload)

  useEffect(() => {
    const busy = (target: EventTarget | null): boolean =>
      useAppStore.getState().newDownloadOpen ||
      (target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName)))

    const onPaste = (event: ClipboardEvent): void => {
      if (busy(event.target)) return
      const link = acceptedLink(event.clipboardData?.getData('text') ?? '')
      if (link) openNewDownload(link)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'n' || !(isMac ? event.metaKey : event.ctrlKey)) return
      if (useAppStore.getState().newDownloadOpen) return
      event.preventDefault()
      openNewDownload()
    }
    const onDragOver = (event: DragEvent): void => event.preventDefault()
    const onDrop = (event: DragEvent): void => {
      event.preventDefault()
      const text = event.dataTransfer?.getData('text') ?? ''
      const link = acceptedLink(text)
      if (link) openNewDownload(link)
    }

    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [openNewDownload])
}
