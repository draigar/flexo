// Injected on web pages to show an elegant floating ribbon/balloon widget over videos
;(function () {
  if (window.__flexoRibbonInjected) return
  window.__flexoRibbonInjected = true

  const detectedStreamsByTab = new Map() // video element -> array of streams
  let activeWidget = null
  let hideTimeout = null

  function createRibbon() {
    const ribbon = document.createElement('div')
    ribbon.id = 'flexo-media-ribbon'
    ribbon.setAttribute('role', 'region')
    ribbon.setAttribute('aria-label', 'Flexo Media Downloader')

    // Styling with isolated CSS
    const shadow = ribbon.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = `
      :host {
        all: initial;
        position: absolute;
        z-index: 2147483647;
        pointer-events: auto;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
        font-size: 12px;
        line-height: 1.4;
      }

      .balloon {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(15, 17, 23, 0.88);
        color: #f1f5f9;
        padding: 5px 10px 5px 8px;
        border-radius: 9999px;
        border: 1px solid rgba(16, 185, 129, 0.35);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(0, 0, 0, 0.2);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        cursor: pointer;
        user-select: none;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        transform-origin: top left;
      }

      .balloon:hover {
        background: rgba(20, 24, 33, 0.96);
        border-color: rgba(16, 185, 129, 0.7);
        box-shadow: 0 6px 20px rgba(16, 185, 129, 0.25), 0 4px 12px rgba(0, 0, 0, 0.5);
        transform: translateY(-1px) scale(1.02);
      }

      .balloon:active {
        transform: translateY(0px) scale(0.98);
      }

      .logo-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: #000;
        flex-shrink: 0;
      }

      .logo-icon svg {
        width: 11px;
        height: 11px;
        fill: currentColor;
      }

      .label {
        font-weight: 600;
        letter-spacing: 0.02em;
        color: #e2e8f0;
      }

      .badge {
        background: rgba(16, 185, 129, 0.15);
        color: #34d399;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 10px;
        padding: 1px 5px;
        border-radius: 4px;
        border: 1px solid rgba(16, 185, 129, 0.3);
      }

      .dropdown {
        display: none;
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        min-width: 200px;
        max-width: 320px;
        background: #0f1117;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        padding: 4px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.7), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
        z-index: 10;
      }

      .dropdown.open {
        display: flex;
        flex-direction: column;
        animation: fadeIn 0.15s ease-out;
      }

      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .dropdown-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 10px;
        border-radius: 5px;
        color: #cbd5e1;
        cursor: pointer;
        transition: background 0.15s;
        gap: 8px;
        text-decoration: none;
      }

      .dropdown-item:hover {
        background: rgba(16, 185, 129, 0.12);
        color: #f8fafc;
      }

      .item-title {
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 180px;
      }

      .item-badge {
        font-size: 9px;
        font-family: ui-monospace, monospace;
        background: rgba(255, 255, 255, 0.08);
        padding: 1px 4px;
        border-radius: 3px;
        color: #94a3b8;
      }
    `

    const container = document.createElement('div')
    container.style.position = 'relative'

    const balloon = document.createElement('div')
    balloon.className = 'balloon'
    balloon.innerHTML = `
      <div class="logo-icon">
        <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
      </div>
      <span class="label">Flexo</span>
      <span class="badge" id="stream-count">1</span>
    `

    const dropdown = document.createElement('div')
    dropdown.className = 'dropdown'

    balloon.addEventListener('click', (e) => {
      e.stopPropagation()
      e.preventDefault()
      dropdown.classList.toggle('open')
    })

    document.addEventListener('click', (e) => {
      if (!ribbon.contains(e.target)) {
        dropdown.classList.remove('open')
      }
    })

    container.appendChild(balloon)
    container.appendChild(dropdown)
    shadow.appendChild(style)
    shadow.appendChild(container)

    return {
      element: ribbon,
      dropdown,
      countBadge: shadow.getElementById('stream-count'),
      setStreams(streams) {
        this.countBadge.textContent = streams.length
        this.dropdown.innerHTML = ''
        streams.forEach((candidate) => {
          const item = document.createElement('div')
          item.className = 'dropdown-item'
          const label = candidate.quality || candidate.kind.toUpperCase() || 'Video'
          const title = candidate.title || (candidate.url.split('/').pop() || 'Video').split('?')[0]

          item.innerHTML = `
            <span class="item-title" title="${title}">${title}</span>
            <span class="item-badge">${label}</span>
          `
          item.addEventListener('click', (ev) => {
            ev.stopPropagation()
            ev.preventDefault()
            dropdown.classList.remove('open')
            chrome.runtime.sendMessage({
              action: 'downloadStream',
              candidate
            })
          })
          this.dropdown.appendChild(item)
        })
      }
    }
  }

  function positionOverVideo(video, widget) {
    const rect = video.getBoundingClientRect()
    if (rect.width < 50 || rect.height < 50) return

    const top = window.scrollY + rect.top + 12
    const left = window.scrollX + rect.left + 12

    widget.element.style.top = `${top}px`
    widget.element.style.left = `${left}px`
  }

  function attachToVideo(video, streams) {
    if (!activeWidget) {
      activeWidget = createRibbon()
      document.body.appendChild(activeWidget.element)
    }

    activeWidget.setStreams(streams)
    positionOverVideo(video, activeWidget)

    // Update position on scroll/resize
    const updatePos = () => {
      if (activeWidget && document.body.contains(activeWidget.element)) {
        positionOverVideo(video, activeWidget)
      }
    }

    window.addEventListener('scroll', updatePos, { passive: true })
    window.addEventListener('resize', updatePos, { passive: true })
  }

  // Listen for media stream messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'mediaStreamsDetected') {
      const candidates = message.candidates || []
      if (!candidates.length) return

      // Find visible video elements on the page
      const videos = Array.from(document.querySelectorAll('video'))
      const visibleVideo =
        videos.find((v) => {
          const rect = v.getBoundingClientRect()
          return (
            rect.width > 100 &&
            rect.height > 100 &&
            rect.bottom > 0 &&
            rect.top < window.innerHeight
          )
        }) || videos[0]

      if (visibleVideo) {
        attachToVideo(visibleVideo, candidates)
      } else {
        // If no explicit video element found yet, observe for one or place at top right
        const observer = new MutationObserver(() => {
          const v = document.querySelector('video')
          if (v) {
            observer.disconnect()
            attachToVideo(v, candidates)
          }
        })
        observer.observe(document.body, { childList: true, subtree: true })
        setTimeout(() => observer.disconnect(), 10000)
      }
      sendResponse({ received: true })
    }
  })
})()
