export type BarcodeLabelLayout = 'thermal' | 'a4'

export const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131',
  '211412',
  '211214',
  '211232',
  '2331112',
] as const

export interface BarcodeEncodedResult {
  value: string
  bars: { x: number; w: number }[]
  totalModules: number
}

export function resolveLabelCode(product: { id: string; barcode?: string | null }): {
  code: string
  isGeneratedSku: boolean
} {
  const raw = String(product.barcode ?? '').trim()
  const clean = Array.from(raw)
    .filter((ch) => {
      const c = ch.charCodeAt(0)
      return c >= 32 && c <= 126
    })
    .join('')
  if (clean) return { code: clean, isGeneratedSku: false }
  const fallback =
    product.id
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 12) || 'ITEM'
  return { code: `SKU-${fallback}`, isGeneratedSku: true }
}

export function encodeCode128Preview(rawValue: string): BarcodeEncodedResult {
  const clean = Array.from(String(rawValue || '').trim())
    .filter((ch) => {
      const c = ch.charCodeAt(0)
      return c >= 32 && c <= 126
    })
    .join('') || 'ITEM'

  const values: number[] = [104]
  let checksum = 104
  for (let i = 0; i < clean.length; i += 1) {
    const val = clean.charCodeAt(i) - 32
    values.push(val)
    checksum += val * (i + 1)
  }
  values.push(checksum % 103)
  values.push(106)

  const quiet = 10
  let cursor = quiet
  const bars: { x: number; w: number }[] = []

  for (const idx of values) {
    const pattern = CODE128_PATTERNS[idx]
    for (let i = 0; i < pattern.length; i += 1) {
      const w = Number(pattern[i])
      if (i % 2 === 0) bars.push({ x: cursor, w })
      cursor += w
    }
  }

  return {
    value: clean,
    bars,
    totalModules: cursor + quiet,
  }
}

export function buildLabelPdfPath(
  productId: string,
  options: { layout: BarcodeLabelLayout; copies: number; includePrice: boolean; download?: boolean }
): string {
  const params = new URLSearchParams({
    layout: options.layout,
    copies: String(Math.min(60, Math.max(1, Math.floor(options.copies || 1)))),
    price: options.includePrice ? '1' : '0',
  })
  if (options.download) params.set('download', '1')
  return `/api/v1/retail/products/${encodeURIComponent(productId)}/label.pdf?${params.toString()}`
}
