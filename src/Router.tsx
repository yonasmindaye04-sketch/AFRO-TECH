import { Suspense, lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'

/* Route-level code splitting: every page group is only downloaded when its
   route is visited. This keeps /app/* routes free of landing-page code
   (Lenis, showcase, etc.) and keeps the landing page free of app code. */
const App = lazy(() => import('./app.tsx'))
const ServicesPage = lazy(() => import('./pages/ServicesPage.tsx'))
const ProductsPage = lazy(() => import('./pages/ProductsPage.tsx'))
const PlatformRoot = lazy(() => import('./platform/index.tsx'))

function Fallback(): JSX.Element {
  return (
    <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', color: 'var(--text-dim)' }} role="status">Loading…</div>
  )
}

export default function Router(): JSX.Element {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Suspense fallback={<Fallback />}>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/services" element={<ServicesPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/app/*" element={<PlatformRoot />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ThemeProvider>
  )
}
