import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { api } from '../api'
import { Badge, Card, ErrorBox } from '../ui'
import {
  classifyCameraDiagnosticError,
  extractStreamDiagnostics,
  formatBarcodeFormatName,
  normalizePermissionState,
  prependScanDetection,
  probeCameraPermission,
  type CameraPermissionStatus,
  type DetectedBarcodeRecord,
  type StreamDiagnostics,
} from '../utils/barcodeDiagnostics'

interface Props {
  onClose?: () => void
  enableProductLookup?: boolean
}

interface CatalogMatch {
  code: string
  status: 'matched' | 'not_found' | 'error'
  productName?: string
  price?: string
  stock?: number
  message?: string
}

const SUPPORTED_FORMATS = [
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

const IDLE_STREAM: StreamDiagnostics = {
  width: 0,
  height: 0,
  resolutionLabel: 'Not started',
  frameRate: null,
  deviceLabel: '—',
  facingMode: null,
  trackState: 'inactive',
}

function permissionBadge(status: CameraPermissionStatus): { tone: 'good' | 'warn' | 'bad' | 'neutral' | 'info'; label: string } {
  switch (status) {
    case 'granted':
      return { tone: 'good', label: 'Granted' }
    case 'prompt':
      return { tone: 'warn', label: 'Prompt Required' }
    case 'denied':
      return { tone: 'bad', label: 'Denied' }
    case 'unsupported':
      return { tone: 'bad', label: 'Unsupported / Blocked' }
    case 'checking':
      return { tone: 'info', label: 'Checking…' }
    default:
      return { tone: 'neutral', label: 'Unknown (Browser Managed)' }
  }
}

export default function BarcodeScannerDiagnostics({ onClose, enableProductLookup = true }: Props): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  const continuousRef = useRef(true)

  const [permission, setPermission] = useState<CameraPermissionStatus>('checking')
  const [secureContext, setSecureContext] = useState<boolean>(true)
  const [mediaSupported, setMediaSupported] = useState<boolean>(true)
  const [streamState, setStreamState] = useState<'idle' | 'starting' | 'active' | 'error'>('idle')
  const [streamError, setStreamError] = useState<string | null>(null)
  const [streamInfo, setStreamInfo] = useState<StreamDiagnostics>(IDLE_STREAM)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  const [continuous, setContinuous] = useState<boolean>(true)
  const [torchSupported, setTorchSupported] = useState<boolean>(false)
  const [torchOn, setTorchOn] = useState<boolean>(false)
  const [detections, setDetections] = useState<DetectedBarcodeRecord[]>([])
  const [catalogMatch, setCatalogMatch] = useState<CatalogMatch | null>(null)

  useEffect(() => {
    continuousRef.current = continuous
  }, [continuous])

  const refreshDevices = useCallback(async (): Promise<void> => {
    try {
      if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
        const list = await navigator.mediaDevices.enumerateDevices()
        setDevices(list.filter((d) => d.kind === 'videoinput'))
      }
    } catch {
      /* ignore enumeration errors */
    }
  }, [])

  // Probe camera permission & device list on mount
  useEffect(() => {
    let cancelled = false
    let permStatusObj: PermissionStatus | null = null
    let onPermChange: (() => void) | null = null

    const init = async (): Promise<void> => {
      const probe = await probeCameraPermission()
      if (cancelled) return
      setPermission(probe.permission)
      setSecureContext(probe.secureContext)
      setMediaSupported(probe.mediaDevicesSupported)
      await refreshDevices()

      try {
        if (navigator.permissions && typeof navigator.permissions.query === 'function') {
          permStatusObj = await navigator.permissions.query({ name: 'camera' as PermissionName })
          onPermChange = () => {
            if (!cancelled && permStatusObj) {
              setPermission(normalizePermissionState(permStatusObj.state))
            }
          }
          permStatusObj.addEventListener?.('change', onPermChange)
        }
      } catch {
        /* ignore */
      }
    }

    void init()
    return () => {
      cancelled = true
      if (permStatusObj && onPermChange) {
        permStatusObj.removeEventListener?.('change', onPermChange)
      }
    }
  }, [refreshDevices])

  const stopCamera = useCallback((): void => {
    try {
      controlsRef.current?.stop()
    } catch {
      /* ignore stop errors */
    }
    controlsRef.current = null
    const video = videoRef.current
    if (video?.srcObject) {
      const stream = video.srcObject as MediaStream
      stream.getTracks().forEach((t) => t.stop())
      video.srcObject = null
    }
    setTorchOn(false)
    setTorchSupported(false)
    setStreamState('idle')
    setStreamInfo(IDLE_STREAM)
  }, [])

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      try {
        controlsRef.current?.stop()
      } catch {
        /* ignore */
      }
      controlsRef.current = null
    }
  }, [])

  const inspectLiveStream = useCallback((): StreamDiagnostics => {
    const video = videoRef.current
    const stream = video?.srcObject as MediaStream | null
    const track = stream?.getVideoTracks()?.[0]
    const settings = track?.getSettings?.() ?? null
    const diag = extractStreamDiagnostics(video, settings, track?.label, track?.readyState)
    setStreamInfo(diag)
    return diag
  }, [])

  // Keep live stream resolution/track state fresh while camera is active
  useEffect(() => {
    if (streamState !== 'active') return
    const timer = window.setInterval(() => {
      inspectLiveStream()
    }, 500)
    return () => window.clearInterval(timer)
  }, [streamState, inspectLiveStream])

  const verifyCatalogBarcode = useCallback(async (rawCode: string): Promise<void> => {
    if (!enableProductLookup) return
    const code = rawCode.trim()
    if (!code) return
    try {
      const res = await api.get<{ product: { name: string; sell_price: string | number; stock: number } }>(
        `/retail/products/barcode/${encodeURIComponent(code)}`
      )
      setCatalogMatch({
        code,
        status: 'matched',
        productName: res.product.name,
        price: String(res.product.sell_price),
        stock: Number(res.product.stock ?? 0),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lookup failed'
      setCatalogMatch({
        code,
        status: /404|no product/i.test(msg) ? 'not_found' : 'error',
        message: msg,
      })
    }
  }, [enableProductLookup])

  const startCamera = useCallback(async (deviceOverride?: string): Promise<void> => {
    stopCamera()
    setStreamError(null)
    setStreamState('starting')

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPermission('unsupported')
      setStreamState('error')
      setStreamError('Camera access requires a secure connection (HTTPS or localhost) with MediaDevices support.')
      return
    }

    const videoEl = videoRef.current
    if (!videoEl) {
      setStreamState('error')
      setStreamError('Video preview element is not mounted.')
      return
    }

    const targetDevice = deviceOverride ?? selectedDeviceId
    const hints = new Map()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_FORMATS)
    hints.set(DecodeHintType.TRY_HARDER, true)
    const reader = new BrowserMultiFormatReader(hints)

    const videoConstraints: MediaTrackConstraints = targetDevice
      ? { deviceId: { exact: targetDevice }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }

    try {
      const controls = await reader.decodeFromConstraints(
        { audio: false, video: videoConstraints },
        videoEl,
        (result) => {
          if (!result) return
          const code = result.getText()
          const now = Date.now()
          if (code === lastScanRef.current.code && now - lastScanRef.current.at < 1200) return
          lastScanRef.current = { code, at: now }

          const diag = inspectLiveStream()
          const formatLabel = formatBarcodeFormatName(result.getBarcodeFormat?.())
          const rec: DetectedBarcodeRecord = {
            id: `${now}-${Math.random().toString(36).slice(2, 6)}`,
            code,
            format: formatLabel,
            resolution: diag.resolutionLabel,
            detectedAt: new Date(now).toISOString(),
          }
          setDetections((prev) => prependScanDetection(prev, rec, 10))
          void verifyCatalogBarcode(code)

          if (!continuousRef.current) {
            stopCamera()
          }
        }
      )

      controlsRef.current = controls
      setPermission('granted')
      setTorchSupported(typeof (controls as IScannerControls & { switchTorch?: unknown }).switchTorch === 'function')
      setStreamState('active')
      inspectLiveStream()
      void refreshDevices()
    } catch (err) {
      const classified = classifyCameraDiagnosticError(err)
      setPermission(classified.permission)
      setStreamState('error')
      setStreamError(classified.message)
      setStreamInfo(IDLE_STREAM)
    }
  }, [inspectLiveStream, refreshDevices, selectedDeviceId, stopCamera, verifyCatalogBarcode])

  const toggleTorch = (): void => {
    const next = !torchOn
    try {
      controlsRef.current?.switchTorch?.(next)
      setTorchOn(next)
    } catch {
      setTorchSupported(false)
    }
  }

  const latest = detections[0] ?? null
  const permMeta = permissionBadge(permission)

  return (
    <Card className="pl-scanner-diag-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>
              <i className="fa-solid fa-camera-retro" style={{ color: 'var(--accent)', marginRight: 8 }} aria-hidden="true" />
              Camera Barcode Scanner Diagnostics
            </h2>
            <Badge tone={streamState === 'active' ? 'good' : streamState === 'error' ? 'bad' : 'neutral'}>
              {streamState === 'active' ? 'STREAM LIVE' : streamState === 'starting' ? 'STARTING' : streamState === 'error' ? 'ERROR' : 'IDLE'}
            </Badge>
          </div>
          <p style={{ color: 'var(--text-dim)', fontSize: '.86rem', margin: '4px 0 0' }}>
            Verify camera permissions, negotiated video resolution, frame rate, and real-time barcode decoding across retail formats.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {streamState === 'active' || streamState === 'starting' ? (
            <button type="button" className="pl-btn pl-btn-danger pl-btn-sm" onClick={stopCamera}>
              <i className="fa-solid fa-stop" aria-hidden="true" /> Stop Camera
            </button>
          ) : (
            <button type="button" className="pl-btn pl-btn-primary pl-btn-sm" onClick={() => void startCamera()}>
              <i className="fa-solid fa-play" aria-hidden="true" /> Start Camera Test
            </button>
          )}
          {onClose && (
            <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => { stopCamera(); onClose() }} aria-label="Close diagnostics">
              Close
            </button>
          )}
        </div>
      </div>

      {/* Real-time Telemetry Grid */}
      <div className="pl-grid-3" style={{ marginBottom: 16 }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', background: 'var(--surface2, transparent)' }}>
          <div style={{ fontSize: '.76rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
            Camera Permission
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={permMeta.tone}>{permMeta.label}</Badge>
            <Badge tone={secureContext ? 'good' : 'bad'}>
              {secureContext ? 'Secure Context (HTTPS/Local)' : 'Insecure HTTP'}
            </Badge>
          </div>
          <small style={{ display: 'block', color: 'var(--text-dim)', marginTop: 6 }}>
            MediaDevices API: {mediaSupported ? 'Available' : 'Unavailable'} · Cameras: {devices.length}
          </small>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', background: 'var(--surface2, transparent)' }}>
          <div style={{ fontSize: '.76rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
            Stream Resolution
          </div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '1.15rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {streamInfo.resolutionLabel}
          </div>
          <small style={{ display: 'block', color: 'var(--text-dim)', marginTop: 4 }}>
            {streamInfo.frameRate ? `${streamInfo.frameRate} fps` : 'FPS: —'}
            {streamInfo.facingMode ? ` · ${streamInfo.facingMode}` : ''}
            {streamInfo.trackState !== 'inactive' ? ` · Track ${streamInfo.trackState}` : ''}
          </small>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', background: 'var(--surface2, transparent)' }}>
          <div style={{ fontSize: '.76rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
            Latest Detected Barcode
          </div>
          {latest ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <code style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent)', wordBreak: 'break-all' }}>{latest.code}</code>
                <Badge tone="info">{latest.format}</Badge>
              </div>
              <small style={{ display: 'block', color: 'var(--text-dim)', marginTop: 4 }}>
                Captured at {new Date(latest.detectedAt).toLocaleTimeString()} ({latest.resolution})
              </small>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600, color: 'var(--text-dim)' }}>Waiting for scan…</div>
              <small style={{ display: 'block', color: 'var(--text-dim)', marginTop: 4 }}>
                Supports EAN-13, EAN-8, UPC, Code 128, Code 39, ITF, QR
              </small>
            </>
          )}
        </div>
      </div>

      {streamError && (
        <div style={{ marginBottom: 14 }}>
          <ErrorBox message={streamError} />
        </div>
      )}

      {/* Preview + Controls & Detection Log */}
      <div className="pl-cols-2">
        <div style={{ minWidth: 0 }}>
          <div className="pl-scanner-frame" style={{ minHeight: 220, width: '100%', maxWidth: '100%', display: 'grid', placeItems: 'center' }}>
            <video
              ref={videoRef}
              style={{
                width: '100%',
                maxWidth: '100%',
                maxHeight: 320,
                objectFit: 'cover',
                display: streamState === 'idle' || streamState === 'error' ? 'none' : 'block',
              }}
              playsInline
              muted
              aria-label="Diagnostic camera stream"
              onLoadedMetadata={() => inspectLiveStream()}
            />
            {streamState === 'active' && <span className="pl-scanner-laser" aria-hidden="true" />}
            {streamState === 'starting' && (
              <span style={{ color: '#fff', fontSize: '.9rem', padding: 24, textAlign: 'center' }}>
                Requesting camera access &amp; negotiating 1280×720 stream…
              </span>
            )}
            {(streamState === 'idle' || streamState === 'error') && (
              <div style={{ color: '#cbd5e1', textAlign: 'center', padding: 28 }}>
                <i className="fa-solid fa-video" aria-hidden="true" style={{ fontSize: '1.8rem', marginBottom: 8, opacity: 0.75 }} />
                <p style={{ margin: 0, fontSize: '.88rem' }}>
                  Click <strong>Start Camera Test</strong> to preview the live video feed and test barcode decoding.
                </p>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
            {devices.length > 0 && (
              <select
                className="pl-select"
                style={{ flex: '1 1 200px' }}
                aria-label="Select camera device"
                value={selectedDeviceId}
                onChange={(e) => {
                  const nextId = e.target.value
                  setSelectedDeviceId(nextId)
                  if (streamState === 'active') {
                    void startCamera(nextId)
                  }
                }}
              >
                <option value="">Auto (Rear Camera Preferred)</option>
                {devices.map((d, idx) => (
                  <option key={d.deviceId || idx} value={d.deviceId}>
                    {d.label || `Camera ${idx + 1}`}
                  </option>
                ))}
              </select>
            )}

            <label className="pl-checkbox-label" style={{ fontSize: '.86rem', whiteSpace: 'nowrap' }}>
              <input
                type="checkbox"
                checked={continuous}
                onChange={(e) => setContinuous(e.target.checked)}
              />
              <span>Continuous scan</span>
            </label>

            {torchSupported && streamState === 'active' && (
              <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={toggleTorch}>
                <i className={torchOn ? 'fa-solid fa-lightbulb' : 'fa-regular fa-lightbulb'} aria-hidden="true" />
                {torchOn ? 'Torch Off' : 'Torch On'}
              </button>
            )}
          </div>

          {streamInfo.deviceLabel !== '—' && (
            <small style={{ display: 'block', color: 'var(--text-dim)', marginTop: 8, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
              Active device: <strong>{streamInfo.deviceLabel}</strong>
            </small>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {enableProductLookup && catalogMatch && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <strong style={{ fontSize: '.86rem' }}>Catalog Barcode Lookup ({catalogMatch.code})</strong>
                <Badge tone={catalogMatch.status === 'matched' ? 'good' : 'warn'}>
                  {catalogMatch.status === 'matched' ? 'PRODUCT MATCHED' : 'NO MATCH IN CATALOG'}
                </Badge>
              </div>
              {catalogMatch.status === 'matched' ? (
                <small style={{ color: 'var(--text-dim)' }}>
                  {catalogMatch.productName} · {catalogMatch.price} ETB · Stock: {catalogMatch.stock}
                </small>
              ) : (
                <small style={{ color: 'var(--text-dim)' }}>
                  {catalogMatch.message || 'No product currently has this barcode assigned.'}
                </small>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '.92rem' }}>Detected Barcode Log ({detections.length})</strong>
            {detections.length > 0 && (
              <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => { setDetections([]); setCatalogMatch(null) }}>
                Clear Log
              </button>
            )}
          </div>

          {detections.length === 0 ? (
            <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: '24px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '.85rem' }}>
              No barcodes decoded in this session yet. Point the camera at any product barcode or QR label.
            </div>
          ) : (
            <div className="pl-table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
              <table className="pl-table" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Format</th>
                    <th>Resolution</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {detections.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <code style={{ fontWeight: 700, color: 'var(--accent)' }}>{d.code}</code>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <Badge tone="info">{d.format}</Badge>
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: '.82rem', whiteSpace: 'nowrap' }}>{d.resolution}</td>
                      <td style={{ fontSize: '.82rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                        {new Date(d.detectedAt).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
