import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'

/** Subscribes once to download, queue, clipboard, and media events for the app lifetime. */
export function useDownloadEvents(): void {
  const setCurrentDownload = useAppStore((store) => store.setCurrentDownload)
  const setQueue = useAppStore((store) => store.setQueue)
  const setDraftUrl = useAppStore((store) => store.setDraftUrl)
  const setCaptureError = useAppStore((store) => store.setCaptureError)
  const setMediaCandidates = useAppStore((store) => store.setMediaCandidates)

  useEffect(() => {
    let disposed = false
    const unsubDownload = window.flexo.onDownloadUpdated(setCurrentDownload)
    const unsubQueue = window.flexo.onQueueUpdated(setQueue)
    const unsubClipboard = window.flexo.onClipboardUrl((url) => {
      setDraftUrl(url)
    })
    const unsubCaptureFailed = window.flexo.onCaptureFailed((failure) => {
      setDraftUrl(failure.url)
      setCaptureError(failure.message)
    })
    const unsubMedia = window.flexo.onMediaCandidates(setMediaCandidates)

    void window.flexo
      .getCurrentDownload()
      .then((download) => {
        if (!disposed && download) setCurrentDownload(download)
      })
      .catch(() => {})

    void window.flexo
      .getQueue()
      .then((queue) => {
        if (!disposed) setQueue(queue)
      })
      .catch(() => {})

    return () => {
      disposed = true
      unsubDownload()
      unsubQueue()
      unsubClipboard()
      unsubCaptureFailed()
      unsubMedia()
    }
  }, [setCurrentDownload, setQueue, setDraftUrl, setCaptureError, setMediaCandidates])
}
