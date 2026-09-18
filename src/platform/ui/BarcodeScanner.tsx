import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'

interface Props {
  onDetected: (code: string) => void
  onClose: () => void
  title?: string
}

const RETAIL_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.QR_CODE,
]

function beep(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'square'
    osc.frequency.value = 1250
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18)
    osc.start()
    osc.stop(ctx.currentTime + 0.2)
    osc.onended = () => void ctx.close()
  } catch {
    /* audio is a nice-to-have */
  }
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/permission|NotAllowed/i.test(msg)) return 'Camera access was denied. Allow camera permission in your browser and try again.'
  if (/NotFound|no camera/i.test(msg)) return 'No camera found on this device.'
  if (msg.includes('mediaDevices') || (typeof navigator !== 'undefined' && !navigator.mediaDevices)) {
    return 'Camera scanning needs a secure connection (HTTPS). Open the app over HTTPS or on localhost.'
  }
  return msg || 'Could not start the camera.'
}

/**
 * Camera barcode scanner for phones/tablets (EAN/UPC/Code128/QR…).
 * Mount it while the scanner should be visible — the camera starts on mount
 * and is always stopped on unmount. The rear camera is preferred.
 */
export default function BarcodeScanner({ onDetected, onClose, title = 'Scan barcode' }: Props): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const detectedRef = useRef(false)
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  const onDetectedRef = useRef(onDetected)

  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  const [status, setStatus] = useState<'starting' | 'scanning' | 'error'>('starting')
  const [error, setError] = useState<string | null>(null)
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)

  useEffect(() => {
    let cancelled = false
    const hints = new Map()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, RETAIL_FORMATS)
    hints.set(DecodeHintType.TRY_HARDER, true)

    const reader = new BrowserMultiFormatReader(hints)

    reader
      .decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        videoRef.current!,
        (result) => {
          if (cancelled || detectedRef.current || !result) return
          const code = result.getText()
          const now = Date.now()
          if (code === lastScanRef.current.code && now - lastScanRef.current.at < 1200) return
          lastScanRef.current = { code, at: now }
          detectedRef.current = true
          beep()
          controlsRef.current?.stop()
          controlsRef.current = null
          onDetectedRef.current(code)
        }
      )
      .then((controls) => {
        if (cancelled) {
          controls.stop()
          return
        }
        controlsRef.current = controls
        setTorchSupported(typeof (controls as IScannerControls & { switchTorch?: unknown }).switchTorch === 'function')
        setStatus('scanning')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setStatus('error')
        setError(friendlyError(e))
      })

    return () => {
      cancelled = true
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [])

  const toggleTorch = (): void => {
    const next = !torchOn
    try {
      controlsRef.current?.switchTorch?.(next)
      setTorchOn(next)
    } catch {
      setTorchSupported(false)
    }
  }

  return (
    <div className="pl-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pl-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="pl-modal-head">
          <h2>{title}</h2>
          <button type="button" className="pl-icon-btn" onClick={onClose} aria-label="Close scanner">
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>
        <div className="pl-modal-body">
          {status === 'error' ? (
            <p role="alert" style={{ color: '#e07a7a', fontSize: '.92rem', textAlign: 'center', padding: '26px 4px' }}>
              <i className="fa-solid fa-camera-slash" aria-hidden="true" style={{ display: 'block', fontSize: '1.8rem', marginBottom: 10 }} />
              {error}
            </p>
          ) : (
            <div className="pl-scanner-frame">
              <video
                ref={videoRef}
                style={{ width: '100%', display: 'block', borderRadius: 10, background: '#000' }}
                playsInline
                muted
                aria-label="Camera preview"
              />
              {status === 'scanning' && <span className="pl-scanner-laser" aria-hidden="true" />}
              {status === 'starting' && (
                <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: '.9rem' }}>
                  Starting camera…
                </span>
              )}
            </div>
          )}
          <p style={{ color: 'var(--text-dim)', fontSize: '.82rem', textAlign: 'center', margin: '12px 0 0' }}>
            {status === 'error' ? 'You can still type the barcode manually.' : 'Point the camera at the product barcode — it scans automatically.'}
          </p>
          {torchSupported && status === 'scanning' && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
              <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={toggleTorch}>
                <i className={torchOn ? 'fa-solid fa-lightbulb' : 'fa-regular fa-lightbulb'} aria-hidden="true" />
                {torchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
