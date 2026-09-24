import { useRef, useState, type ChangeEvent } from 'react'

export interface ScannedExpense {
  amount?: string
  date?: string
  description?: string
}

interface Props {
  onApply: (fields: ScannedExpense) => void
  onClose: () => void
}

type Stage = 'pick' | 'processing' | 'review' | 'error'

/* ── Text parsing helpers ─────────────────────────────────── */

const CURRENCY_WORDS = /(total|grand|amount|amt|paid|payable|balance|due|birr|etb|\bbr\.?\b|cash)/i
const DATE_LIKE = /\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/

function extractNumbers(line: string): number[] {
  const out: number[] = []
  // Match comma-grouped or decimal numbers, not fragments of longer digit runs (phones, serials)
  const re = /(?<![\d,.])(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d{1,6})(?![\d,.])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    const n = Number(m[0].replace(/,/g, ''))
    if (Number.isFinite(n) && n > 0 && n < 10_000_000) out.push(n)
  }
  return out
}

function parseAmount(text: string): string | undefined {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const keywordHits: number[] = []
  const decimals: number[] = []
  const all: number[] = []
  for (const line of lines) {
    // Lines that are only a date/time carry no money info
    if (DATE_LIKE.test(line) && !CURRENCY_WORDS.test(line)) continue
    const nums = extractNumbers(line)
    all.push(...nums)
    for (const n of nums) {
      if (String(n).includes('.') || /\.[0-9]{2}\b/.test(line)) decimals.push(n)
    }
    if (CURRENCY_WORDS.test(line)) keywordHits.push(...nums)
  }
  const pick = keywordHits.length
    ? Math.max(...keywordHits)
    : decimals.length
      ? Math.max(...decimals)
      : all.length
        ? Math.max(...all)
        : undefined
  return pick === undefined ? undefined : pick.toFixed(2)
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function fmtDate(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parseDate(text: string): string | undefined {
  // yyyy-mm-dd / yyyy/mm/dd / yyyy.mm.dd
  let m = text.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) { const r = fmtDate(+m[1], +m[2], +m[3]); if (r) return r }
  // dd/mm/yyyy (day-first is the common Ethiopian receipt convention)
  m = text.match(/(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})/)
  if (m) { const r = fmtDate(+m[3], +m[2], +m[1]); if (r) return r }
  // 23 Sep 2026 / Sep 23, 2026
  m = text.match(/\b(\d{1,2})\s*([A-Za-z]{3,9})\s*,?\s*(20\d{2})\b/)
  if (m) { const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; const r = mo ? fmtDate(+m[3], mo, +m[1]) : null; if (r) return r }
  m = text.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(20\d{2})\b/)
  if (m) { const mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; const r = mo ? fmtDate(+m[3], mo, +m[2]) : null; if (r) return r }
  return undefined
}

const SKIP_LINE = /(receipt|invoice|order|tel|phone|fax|mobile|vat|tin|tax|date|time|cashier|waiter|table|branch|address|no\.|#|www\.|http)/i

function parseMerchant(text: string): string | undefined {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6)
  for (const line of lines) {
    const letters = line.replace(/[^A-Za-z]/g, '')
    if (letters.length >= 3 && line.length <= 60 && !SKIP_LINE.test(line)) return line
  }
  return undefined
}

function friendlyOcrError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/network|fetch|load/i.test(msg)) return 'Could not load the OCR engine — check your internet connection and try again.'
  return msg || 'Could not read this image.'
}

/* ── Component ────────────────────────────────────────────── */

/**
 * Receipt OCR scanner. Take a photo (mobile camera) or upload an image —
 * text is extracted locally in the browser with Tesseract.js (no server
 * upload) and parsed into amount / date / description for review.
 */
export default function ReceiptScanner({ onApply, onClose }: Props): JSX.Element {
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('pick')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [preview, setPreview] = useState<string | null>(null)
  const [fields, setFields] = useState<ScannedExpense>({})
  const [raw, setRaw] = useState('')
  const [showRaw, setShowRaw] = useState(false)

  const cleanup = (): void => {
    if (preview) URL.revokeObjectURL(preview)
  }

  const close = (): void => {
    cleanup()
    onClose()
  }

  const handleFile = async (file: File): Promise<void> => {
    setError(null)
    setShowRaw(false)
    setRaw('')
    if (preview) URL.revokeObjectURL(preview)
    const url = URL.createObjectURL(file)
    setPreview(url)
    setStage('processing')
    setProgress(0)
    try {
      const { createWorker, OEM } = await import('tesseract.js')
      const worker = await createWorker('eng', OEM.LSTM, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') setProgress(Math.round(m.progress * 100))
        },
      })
      const { data } = await worker.recognize(url)
      await worker.terminate()
      const text = (data.text ?? '').trim()
      if (!text) {
        setError('No readable text found. Try a sharper, well-lit photo of the receipt.')
        setStage('error')
        return
      }
      setRaw(text)
      setFields({ amount: parseAmount(text), date: parseDate(text), description: parseMerchant(text) })
      setStage('review')
    } catch (e) {
      setError(friendlyOcrError(e))
      setStage('error')
    }
  }

  const onFileChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void handleFile(file)
  }

  const apply = (): void => {
    const out: ScannedExpense = {}
    if (fields.amount?.trim()) out.amount = fields.amount.trim()
    if (fields.date?.trim()) out.date = fields.date.trim()
    if (fields.description?.trim()) out.description = fields.description.trim()
    cleanup()
    onApply(out)
  }

  const nothingFound = stage === 'review' && !fields.amount && !fields.date && !fields.description

  return (
    <div className="pl-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="pl-modal" role="dialog" aria-modal="true" aria-label="Scan receipt">
        <div className="pl-modal-head">
          <h2>Scan Receipt</h2>
          <button type="button" className="pl-icon-btn" onClick={close} aria-label="Close scanner">
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>
        <div className="pl-modal-body">
          {/* Hidden inputs — camera (mobile) or file picker */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFileChange} />
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFileChange} />

          {stage === 'pick' && (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', padding: '18px 0 6px' }}>
                <button type="button" className="pl-btn pl-btn-primary" onClick={() => cameraRef.current?.click()}>
                  <i className="fa-solid fa-camera" aria-hidden="true" /> Take Photo
                </button>
                <button type="button" className="pl-btn pl-btn-ghost" onClick={() => fileRef.current?.click()}>
                  <i className="fa-solid fa-image" aria-hidden="true" /> Upload Image
                </button>
              </div>
              <p style={{ color: 'var(--text-dim)', fontSize: '.82rem', textAlign: 'center', margin: '10px 0 0' }}>
                Works best with a flat, well-lit receipt. Text is read on your device — nothing is uploaded.
              </p>
            </>
          )}

          {stage === 'processing' && (
            <div style={{ textAlign: 'center', padding: '18px 0' }}>
              {preview && (
                <img src={preview} alt="Receipt preview" style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 10, objectFit: 'contain', background: '#000' }} />
              )}
              <div style={{ margin: '14px auto 6px', maxWidth: 320, height: 6, borderRadius: 999, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
                <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent, #c9a227)', transition: 'width .2s ease' }} />
              </div>
              <p style={{ color: 'var(--text-dim)', fontSize: '.85rem', margin: 0 }}>
                Reading receipt… {progress}%
              </p>
            </div>
          )}

          {stage === 'error' && (
            <p role="alert" style={{ color: '#e07a7a', fontSize: '.92rem', textAlign: 'center', padding: '22px 4px' }}>
              <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" style={{ display: 'block', fontSize: '1.8rem', marginBottom: 10 }} />
              {error}
            </p>
          )}

          {stage === 'review' && (
            <>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {preview && (
                  <img src={preview} alt="Receipt preview" style={{ width: 84, height: 84, borderRadius: 10, objectFit: 'cover', flexShrink: 0, background: '#000' }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label className="pl-field">
                    <span className="pl-field-label">Amount (ETB)</span>
                    <input className="pl-input" type="number" min="0" step="0.01" value={fields.amount ?? ''} onChange={(e) => setFields({ ...fields, amount: e.target.value })} />
                  </label>
                  <label className="pl-field" style={{ marginTop: 8 }}>
                    <span className="pl-field-label">Date</span>
                    <input className="pl-input" type="date" value={fields.date ?? ''} onChange={(e) => setFields({ ...fields, date: e.target.value })} />
                  </label>
                  <label className="pl-field" style={{ marginTop: 8 }}>
                    <span className="pl-field-label">Description</span>
                    <input className="pl-input" value={fields.description ?? ''} onChange={(e) => setFields({ ...fields, description: e.target.value })} placeholder="Merchant / note" />
                  </label>
                </div>
              </div>
              {nothingFound && (
                <p style={{ color: '#d97706', fontSize: '.84rem', marginTop: 10 }}>
                  Nothing could be detected automatically — you can type the values above from the receipt image.
                </p>
              )}
              {raw && (
                <div style={{ marginTop: 10 }}>
                  <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => setShowRaw(!showRaw)}>
                    <i className={`fa-solid ${showRaw ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true" /> {showRaw ? 'Hide' : 'Show'} scanned text
                  </button>
                  {showRaw && (
                    <pre style={{ marginTop: 8, maxHeight: 140, overflow: 'auto', fontSize: '.76rem', padding: 10, borderRadius: 8, background: 'rgba(255,255,255,.04)', whiteSpace: 'pre-wrap' }}>
                      {raw}
                    </pre>
                  )}
                </div>
              )}
            </>
          )}

          <div className="pl-form-actions">
            {stage === 'review' ? (
              <>
                <button type="button" className="pl-btn pl-btn-ghost" onClick={() => { cleanup(); setPreview(null); setStage('pick') }}>
                  <i className="fa-solid fa-rotate-left" aria-hidden="true" /> Retake
                </button>
                <button type="button" className="pl-btn pl-btn-primary" onClick={apply}>
                  <i className="fa-solid fa-check" aria-hidden="true" /> Apply to Form
                </button>
              </>
            ) : (
              <button type="button" className="pl-btn pl-btn-ghost" onClick={close}>Cancel</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
