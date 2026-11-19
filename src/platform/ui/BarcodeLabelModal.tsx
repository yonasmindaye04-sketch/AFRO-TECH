import { useEffect, useMemo, useRef, useState } from 'react'
import { loadAuth } from '../api'
import { Modal } from '../ui'
import {
  buildLabelPdfPath,
  encodeCode128Preview,
  resolveLabelCode,
  type BarcodeLabelLayout,
} from '../utils/barcodeLabel'

export interface LabelProduct {
  id: string
  name: string
  category: string
  unit: string
  sell_price: string
  barcode?: string | null
}

interface PdfResultState {
  key: string
  url: string
  bytes: number
  filename: string
}

interface PdfErrorState {
  key: string
  message: string
}

export default function BarcodeLabelModal({
  product,
  businessName,
  onClose,
}: {
  product: LabelProduct | null
  businessName: string
  onClose: () => void
}): JSX.Element | null {
  const [layout, setLayout] = useState<BarcodeLabelLayout>('thermal')
  const [copies, setCopies] = useState<number>(1)
  const [includePrice, setIncludePrice] = useState<boolean>(true)
  const [pdfResult, setPdfResult] = useState<PdfResultState | null>(null)
  const [pdfErrorState, setPdfErrorState] = useState<PdfErrorState | null>(null)
  const [printing, setPrinting] = useState<boolean>(false)

  const printFrameRef = useRef<HTMLIFrameElement>(null)

  const resolved = useMemo(
    () => (product ? resolveLabelCode(product) : { code: '', isGeneratedSku: false }),
    [product]
  )
  const encoded = useMemo(
    () => (resolved.code ? encodeCode128Preview(resolved.code) : null),
    [resolved.code]
  )

  const requestKey = product ? `${product.id}:${layout}:${copies}:${includePrice}` : null

  useEffect(() => {
    if (!product || !requestKey) return

    const controller = new AbortController()
    const auth = loadAuth()
    const url = buildLabelPdfPath(product.id, { layout, copies, includePrice })

    fetch(url, {
      signal: controller.signal,
      headers: auth ? { Authorization: `Bearer ${auth.token}` } : undefined,
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Could not generate barcode PDF (${res.status})`)
        }
        const disp = res.headers.get('Content-Disposition') || ''
        const match = /filename="?([^";]+)"?/i.exec(disp)
        const resolvedName = match?.[1] || `label-${resolved.code}.pdf`
        const blob = await res.blob()
        if (controller.signal.aborted) return
        const nextObjectUrl = URL.createObjectURL(blob)
        setPdfErrorState(null)
        setPdfResult({
          key: requestKey,
          url: nextObjectUrl,
          bytes: blob.size,
          filename: resolvedName,
        })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setPdfErrorState({
          key: requestKey,
          message: err instanceof Error ? err.message : 'PDF generation failed',
        })
      })

    return () => {
      controller.abort()
    }
  }, [product, requestKey, layout, copies, includePrice, resolved.code])

  useEffect(() => {
    const activeUrl = pdfResult?.url
    return () => {
      if (activeUrl) URL.revokeObjectURL(activeUrl)
    }
  }, [pdfResult?.url])

  if (!product) return null

  const activePdf = pdfResult?.key === requestKey ? pdfResult : null
  const activeError = pdfErrorState?.key === requestKey ? pdfErrorState.message : null
  const loadingPdf = Boolean(requestKey && !activePdf && !activeError)

  const formattedPrice = `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: Number.isInteger(Number(product.sell_price)) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Number(product.sell_price || 0))} ETB`

  const handlePrintPdf = (): void => {
    if (!activePdf?.url) return
    const frame = printFrameRef.current
    if (!frame) return
    setPrinting(true)
    const triggerPrint = (): void => {
      try {
        frame.contentWindow?.focus()
        frame.contentWindow?.print()
      } catch {
        window.print()
      } finally {
        setPrinting(false)
      }
    }
    if (frame.getAttribute('src') === activePdf.url) {
      triggerPrint()
    } else {
      frame.onload = () => {
        triggerPrint()
      }
      frame.setAttribute('src', activePdf.url)
    }
  }

  return (
    <Modal open={Boolean(product)} title={`Print Barcode Label · ${product.name}`} onClose={onClose} wide>
      <div className="pl-label-modal-body" data-testid="barcode-label-modal">
        <div className="pl-label-controls">
          <label className="pl-field" style={{ marginBottom: 0 }}>
            <span className="pl-field-label">Paper / Label format</span>
            <select
              className="pl-select"
              value={layout}
              onChange={(e) => {
                const nextLayout = e.target.value === 'a4' ? 'a4' : 'thermal'
                setLayout(nextLayout)
                if (nextLayout === 'a4' && copies === 1) setCopies(12)
                if (nextLayout === 'thermal' && copies > 10) setCopies(1)
              }}
              data-testid="label-layout-select"
            >
              <option value="thermal">50 × 30 mm Thermal Label</option>
              <option value="a4">A4 Printable Sheet (24 labels/page)</option>
            </select>
          </label>

          <label className="pl-field" style={{ marginBottom: 0 }}>
            <span className="pl-field-label">Copies</span>
            <input
              type="number"
              className="pl-input"
              min={1}
              max={60}
              value={copies}
              onChange={(e) => setCopies(Math.min(60, Math.max(1, Number(e.target.value) || 1)))}
              data-testid="label-copies-input"
            />
          </label>

          <div className="pl-label-checkbox-wrap">
            <label className="pl-checkbox-label">
              <input
                type="checkbox"
                checked={includePrice}
                onChange={(e) => setIncludePrice(e.target.checked)}
                data-testid="label-include-price-checkbox"
              />
              <span>Show retail price</span>
            </label>
          </div>
        </div>

        {/* High-contrast white label preview reflecting printed PDF output */}
        <div className="pl-label-preview-stage">
          <div className="pl-label-sticker" data-testid="barcode-label-preview">
            <div className="pl-label-sticker-head">
              <span>{businessName}</span>
              <span>{product.unit || 'pcs'}</span>
            </div>
            <div className="pl-label-sticker-title">{product.name}</div>
            {encoded && (
              <svg
                className="pl-label-svg"
                viewBox={`0 0 ${encoded.totalModules} 48`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`Code 128 barcode for ${encoded.value}`}
              >
                <rect x="0" y="0" width={encoded.totalModules} height="48" fill="#ffffff" />
                {encoded.bars.map((b, i) => (
                  <rect key={i} x={b.x} y="2" width={b.w} height="44" fill="#000000" />
                ))}
              </svg>
            )}
            <div className="pl-label-sticker-code">{resolved.code}</div>
            {includePrice && (
              <div className="pl-label-sticker-price">
                {formattedPrice} / {product.unit || 'pcs'}
              </div>
            )}
          </div>
          {resolved.isGeneratedSku && (
            <small className="pl-label-sku-note">
              No barcode assigned — generated scannable Code 128 SKU label ({resolved.code}).
            </small>
          )}
        </div>

        {activeError && (
          <p role="alert" style={{ color: '#e07a7a', fontSize: '.86rem', margin: 0 }}>
            {activeError}
          </p>
        )}

        <div className="pl-label-footer">
          <div className="pl-label-pdf-meta" data-testid="label-pdf-status">
            {loadingPdf ? (
              <span>
                <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" /> Generating printable PDF…
              </span>
            ) : activePdf ? (
              <span>
                <i className="fa-solid fa-file-pdf" aria-hidden="true" /> Ready: <strong>{activePdf.filename}</strong> ·{' '}
                {(activePdf.bytes / 1024).toFixed(1)} KB · {copies} label{copies === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>

          <div className="pl-label-actions">
            {activePdf && (
              <a
                href={activePdf.url}
                download={activePdf.filename}
                className="pl-btn pl-btn-ghost"
                data-testid="download-label-pdf-btn"
              >
                <i className="fa-solid fa-download" aria-hidden="true" /> Download PDF
              </a>
            )}
            <button
              type="button"
              className="pl-btn pl-btn-primary"
              disabled={!activePdf || loadingPdf || printing}
              onClick={handlePrintPdf}
              data-testid="print-label-pdf-btn"
            >
              <i className="fa-solid fa-print" aria-hidden="true" /> {printing ? 'Opening print…' : 'Print Label'}
            </button>
          </div>
        </div>

        <iframe
          ref={printFrameRef}
          title="Printable barcode PDF frame"
          style={{ position: 'fixed', width: 0, height: 0, border: 0, opacity: 0, pointerEvents: 'none' }}
        />
      </div>
    </Modal>
  )
}
