import React from 'react'
import ReactDOM from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import Router from './Router.tsx'
import './index.css'

/* Non-critical stylesheets (Google Fonts, Font Awesome) are declared with
   media="print" in index.html so they don't block rendering. Flip them to
   media="all" as soon as each one finishes loading. Done here instead of via
   inline onload handlers, which the Content-Security-Policy forbids. */
function activateAsyncStyles(): void {
  const links = document.querySelectorAll<HTMLLinkElement>('link[data-async-css]')
  const activate = (link: HTMLLinkElement): void => {
    if (link.media === 'print') link.media = 'all'
  }
  links.forEach((link) => {
    try {
      // Already fetched (cache) — flip immediately
      if (link.sheet) { activate(link); return }
    } catch { /* cross-origin Sheet access — treat as pending */ }
    link.addEventListener('load', () => activate(link), { once: true })
  })
  // Final safety net: nothing must stay in print mode after full load.
  window.addEventListener('load', () => links.forEach(activate), { once: true })
}
activateAsyncStyles()

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Failed to find the root element. Make sure your HTML has a <div id="root"></div>.')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Router />
    <Analytics />
  </React.StrictMode>
)
