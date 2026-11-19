export type CameraPermissionStatus = 'checking' | 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown'

export interface StreamDiagnostics {
  width: number
  height: number
  resolutionLabel: string
  frameRate: number | null
  deviceLabel: string
  facingMode: string | null
  trackState: string
}

export interface DetectedBarcodeRecord {
  id: string
  code: string
  format: string
  resolution: string
  detectedAt: string
}

// Standard @zxing/library BarcodeFormat numeric enum values (0..17)
const FORMAT_NAMES: Record<number, string> = {
  0: 'Aztec',
  1: 'Codabar',
  2: 'Code 39',
  3: 'Code 93',
  4: 'Code 128',
  5: 'Data Matrix',
  6: 'EAN-8',
  7: 'EAN-13',
  8: 'ITF',
  9: 'MaxiCode',
  10: 'PDF417',
  11: 'QR Code',
  12: 'RSS-14',
  13: 'RSS Expanded',
  14: 'UPC-A',
  15: 'UPC-E',
  16: 'UPC/EAN Ext',
  17: 'Micro QR',
}

export function formatBarcodeFormatName(format: number | string | null | undefined): string {
  if (format === null || format === undefined) return 'Unknown'
  if (typeof format === 'number' && FORMAT_NAMES[format]) {
    return FORMAT_NAMES[format]
  }
  const num = Number(format)
  if (!Number.isNaN(num) && FORMAT_NAMES[num]) {
    return FORMAT_NAMES[num]
  }
  return String(format)
}

export function normalizePermissionState(state: string | null | undefined): CameraPermissionStatus {
  if (state === 'granted' || state === 'denied' || state === 'prompt') return state
  return 'unknown'
}

export async function probeCameraPermission(): Promise<{
  permission: CameraPermissionStatus
  secureContext: boolean
  mediaDevicesSupported: boolean
}> {
  const secureContext = typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false
  const mediaDevicesSupported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function')

  if (!mediaDevicesSupported) {
    return { permission: 'unsupported', secureContext, mediaDevicesSupported: false }
  }

  try {
    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      const status = await navigator.permissions.query({ name: 'camera' as PermissionName })
      return {
        permission: normalizePermissionState(status?.state),
        secureContext,
        mediaDevicesSupported: true,
      }
    }
  } catch {
    // Safari / Firefox older versions throw on permissions.query({ name: 'camera' })
  }

  return { permission: 'unknown', secureContext, mediaDevicesSupported: true }
}

export function extractStreamDiagnostics(
  videoEl: { videoWidth?: number; videoHeight?: number } | null | undefined,
  trackSettings?: {
    width?: number
    height?: number
    frameRate?: number
    facingMode?: string
  } | null,
  deviceLabel?: string | null,
  trackState?: string | null
): StreamDiagnostics {
  const vw = Number(videoEl?.videoWidth || 0)
  const vh = Number(videoEl?.videoHeight || 0)
  const tw = Number(trackSettings?.width || 0)
  const th = Number(trackSettings?.height || 0)
  const width = vw > 0 ? vw : tw
  const height = vh > 0 ? vh : th

  return {
    width,
    height,
    resolutionLabel: width > 0 && height > 0 ? `${width} × ${height}` : 'Negotiating…',
    frameRate: typeof trackSettings?.frameRate === 'number' && trackSettings.frameRate > 0
      ? Math.round(trackSettings.frameRate)
      : null,
    deviceLabel: (deviceLabel || '').trim() || 'Default Camera',
    facingMode: trackSettings?.facingMode || null,
    trackState: trackState || 'inactive',
  }
}

export function prependScanDetection(
  history: readonly DetectedBarcodeRecord[],
  record: DetectedBarcodeRecord,
  maxItems = 10
): DetectedBarcodeRecord[] {
  return [record, ...history].slice(0, Math.max(1, maxItems))
}

export function classifyCameraDiagnosticError(err: unknown): {
  permission: CameraPermissionStatus
  message: string
} {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err || '')
  if (/NotAllowedError|PermissionDeniedError|permission/i.test(raw)) {
    return {
      permission: 'denied',
      message: 'Camera permission was denied. Grant camera access in your browser site settings and retry.',
    }
  }
  if (/NotFoundError|DevicesNotFoundError|no camera|requested device not found/i.test(raw)) {
    return {
      permission: 'unsupported',
      message: 'No camera hardware was detected on this device.',
    }
  }
  if (/NotReadableError|TrackStartError|in use/i.test(raw)) {
    return {
      permission: 'granted',
      message: 'Camera is currently in use by another application or browser tab.',
    }
  }
  if (/OverconstrainedError/i.test(raw)) {
    return {
      permission: 'granted',
      message: 'Selected camera does not support the requested resolution constraints.',
    }
  }
  if (/mediaDevices|secure context|https/i.test(raw)) {
    return {
      permission: 'unsupported',
      message: 'Camera access requires a secure context (HTTPS or localhost).',
    }
  }
  return {
    permission: 'unknown',
    message: raw.trim() || 'Unable to start camera stream.',
  }
}
