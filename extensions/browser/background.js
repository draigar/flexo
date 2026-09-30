const NM_HOST = 'com.flexo.app'
const FLEXO_CAPTURE = 'http://127.0.0.1:17890/capture'
const FLEXO_MEDIA = 'http://127.0.0.1:17890/media'

const MEDIA_HINT = /\.(mp4|webm|m4v|mov|m3u8|mpd)(\?|$)/i
const DOWNLOAD_URL = /^(https?:|magnet:)/i

async function sendViaNativeMessaging(body) {
  return new Promise((resolve) => {
    try {
      if (!chrome.runtime.connectNative) {
        resolve(false)
        return
      }
      const port = chrome.runtime.connectNative(NM_HOST)
      let resolved = false

      port.onMessage.addListener((msg) => {
        if (!resolved) {
          resolved = true
          resolve(!!msg?.ok)
          try {
            port.disconnect()
          } catch {}
        }
      })

      port.onDisconnect.addListener(() => {
        if (!resolved) {
          resolved = true
          resolve(false)
        }
      })

      port.postMessage(body)
    } catch {
      resolve(false)
    }
  })
}

async function postJson(url, body) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    return response.ok
  } catch {
    return false
  }
}

function fileNameOf(item) {
  const raw = item.filename || ''
  const base = raw.split(/[/\\]/).pop()
  return base || undefined
}

function captureBody(item) {
  return {
    url: item.finalUrl || item.url,
    fileName: fileNameOf(item),
    referrer: item.referrer || undefined
  }
}

async function launchFlexo(body) {
  const params = new URLSearchParams()
  params.set('url', body.url)
  if (body.fileName) params.set('fileName', body.fileName)
  try {
    await chrome.tabs.create({ url: `flexo://download?${params.toString()}` })
    return true
  } catch {
    return false
  }
}

async function takeDownload(item) {
  const url = item.finalUrl || item.url
  if (!url || url.startsWith('blob:') || url.startsWith('data:') || !DOWNLOAD_URL.test(url)) return
  const body = captureBody({ ...item, url })

  // 1. Try Native Messaging first (auto-registered host)
  let accepted = await sendViaNativeMessaging(body)

  // 2. Fall back to local HTTP TCP handoff server
  if (!accepted) {
    accepted = await postJson(FLEXO_CAPTURE, body)
  }

  // 3. Fall back to deep link (launches Flexo if not running)
  if (!accepted) {
    await launchFlexo(body)
    return
  }

  try {
    await chrome.downloads.cancel(item.id)
  } catch {
    // The download may already have finished.
  }
  try {
    await chrome.downloads.erase({ id: item.id })
  } catch {
    // Erase is best-effort so the browser shelf does not keep a cancelled row.
  }
}

chrome.downloads.onCreated.addListener((item) => {
  void takeDownload(item)
})

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.type !== 'media' && !MEDIA_HINT.test(details.url)) return
    const body = {
      candidates: [
        {
          id: `${Date.now()}-${details.requestId}`,
          url: details.url,
          kind: details.url.includes('.m3u8')
            ? 'hls'
            : details.url.includes('.mpd')
              ? 'dash'
              : 'progressive',
          mimeType: details.responseHeaders?.find(
            (header) => header.name.toLowerCase() === 'content-type'
          )?.value,
          drm: false
        }
      ]
    }
    void (async () => {
      let accepted = await sendViaNativeMessaging(body)
      if (!accepted) void postJson(FLEXO_MEDIA, body)
    })()
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
)

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.url || !DOWNLOAD_URL.test(tab.url)) return
  const body = { url: tab.url, fileName: tab.title || undefined }
  void (async () => {
    let accepted = await sendViaNativeMessaging(body)
    if (!accepted) accepted = await postJson(FLEXO_CAPTURE, body)
    if (!accepted) void launchFlexo(body)
  })()
})
