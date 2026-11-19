import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyCameraDiagnosticError,
  extractStreamDiagnostics,
  formatBarcodeFormatName,
  normalizePermissionState,
  prependScanDetection,
} from './barcodeDiagnostics'

test('formatBarcodeFormatName maps ZXing enum values to readable symbology names', () => {
  assert.equal(formatBarcodeFormatName(7), 'EAN-13')
  assert.equal(formatBarcodeFormatName(4), 'Code 128')
  assert.equal(formatBarcodeFormatName(11), 'QR Code')
  assert.equal(formatBarcodeFormatName(undefined), 'Unknown')
})

test('normalizePermissionState handles standard and unknown browser states cleanly', () => {
  assert.equal(normalizePermissionState('granted'), 'granted')
  assert.equal(normalizePermissionState('denied'), 'denied')
  assert.equal(normalizePermissionState('prompt'), 'prompt')
  assert.equal(normalizePermissionState('something-else'), 'unknown')
  assert.equal(normalizePermissionState(null), 'unknown')
})

test('extractStreamDiagnostics prefers live video dimensions and falls back to track settings', () => {
  const live = extractStreamDiagnostics(
    { videoWidth: 1280, videoHeight: 720 },
    { width: 640, height: 480, frameRate: 29.97, facingMode: 'environment' },
    'Back Camera',
    'live'
  )
  assert.equal(live.width, 1280)
  assert.equal(live.height, 720)
  assert.equal(live.resolutionLabel, '1280 × 720')
  assert.equal(live.frameRate, 30)
  assert.equal(live.deviceLabel, 'Back Camera')
  assert.equal(live.facingMode, 'environment')
  assert.equal(live.trackState, 'live')

  const pending = extractStreamDiagnostics({ videoWidth: 0, videoHeight: 0 }, null, '', null)
  assert.equal(pending.resolutionLabel, 'Negotiating…')
  assert.equal(pending.deviceLabel, 'Default Camera')
  assert.equal(pending.trackState, 'inactive')
})

test('prependScanDetection prepends without mutating and respects maxItems cap', () => {
  const initial = [
    { id: '1', code: '6001', format: 'EAN-13', resolution: '1280 × 720', detectedAt: '2026-11-18T10:00:00Z' },
  ]
  const next = prependScanDetection(
    initial,
    { id: '2', code: '6002', format: 'Code 128', resolution: '1280 × 720', detectedAt: '2026-11-18T10:00:05Z' },
    1
  )
  assert.equal(initial.length, 1)
  assert.equal(next.length, 1)
  assert.equal(next[0]?.code, '6002')
})

test('classifyCameraDiagnosticError maps permission, hardware, and busy camera errors accurately', () => {
  const denied = classifyCameraDiagnosticError(new Error('NotAllowedError: Permission denied'))
  assert.equal(denied.permission, 'denied')
  assert.match(denied.message, /permission/i)

  const missing = classifyCameraDiagnosticError(new Error('NotFoundError: Requested device not found'))
  assert.equal(missing.permission, 'unsupported')
  assert.match(missing.message, /No camera hardware/i)

  const busy = classifyCameraDiagnosticError(new Error('NotReadableError: Device in use'))
  assert.equal(busy.permission, 'granted')
  assert.match(busy.message, /in use/i)
})
