import { Suspense, lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import App from './app.tsx'
import ServicesPage from './pages/ServicesPage.tsx'
import ProductsPage from './pages/ProductsPage.tsx'

const PlatformRoot = lazy(() => import('./platform/index.tsx'))

function Fallback(): JSX.Element {
  return (
    <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', color: 'var(--text-dim)' }}>Loading…</div>
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
