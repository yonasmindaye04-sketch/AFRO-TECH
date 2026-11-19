import PDFDocument from 'pdfkit';

// ISO/IEC 15417 Code 128 module width patterns (indices 0..106)
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
  '211412', // 103: Start A
  '211214', // 104: Start B
  '211232', // 105: Start C
  '2331112', // 106: Stop
];

/**
 * Encodes printable ASCII text into Code 128B black bar segments & total module width.
 * Includes 10-module left & right quiet zones so scanners decode reliably.
 */
export function encodeCode128B(rawValue) {
  const clean = Array.from(String(rawValue || '').trim())
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code <= 126;
    })
    .join('');

  if (!clean) {
    throw new Error('Barcode value must contain at least one printable ASCII character');
  }

  const values = [104]; // Start Code B
  let checksum = 104;
  for (let i = 0; i < clean.length; i += 1) {
    const val = clean.charCodeAt(i) - 32;
    values.push(val);
    checksum += val * (i + 1);
  }
  values.push(checksum % 103);
  values.push(106); // Stop

  const quietModules = 10;
  let cursor = quietModules;
  const bars = [];

  for (const symbolIndex of values) {
    const pattern = CODE128_PATTERNS[symbolIndex];
    for (let i = 0; i < pattern.length; i += 1) {
      const width = Number(pattern[i]);
      const isBar = i % 2 === 0;
      if (isBar) {
        bars.push({ x: cursor, w: width });
      }
      cursor += width;
    }
  }

  const totalModules = cursor + quietModules;
  return {
    value: clean,
    bars,
    totalModules,
    quietModules,
  };
}

export function resolveProductBarcodeValue(product) {
  const raw = String(product?.barcode || '').trim();
  const printable = Array.from(raw)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code <= 126;
    })
    .join('');
  if (printable) {
    return { code: printable, isGeneratedSku: false };
  }
  const fallbackId = String(product?.id || 'ITEM')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 12) || 'ITEM';
  return { code: `SKU-${fallbackId}`, isGeneratedSku: true };
}

export function buildProductLabelPayload(product, tenantInfo = {}, options = {}) {
  const { code, isGeneratedSku } = resolveProductBarcodeValue(product);
  const layout = String(options.layout || 'thermal').toLowerCase() === 'a4' ? 'a4' : 'thermal';
  const rawCopies = Number(options.copies ?? 1);
  const copies = Number.isFinite(rawCopies) ? Math.min(60, Math.max(1, Math.floor(rawCopies))) : 1;
  const includePrice = options.includePrice !== false && options.includePrice !== '0' && options.includePrice !== 'false';
  const currency = String(tenantInfo.currency || 'ETB').trim().toUpperCase();
  const sellPrice = Number(product?.sell_price ?? 0);
  const priceText = `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: Number.isInteger(sellPrice) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(sellPrice) ? sellPrice : 0)} ${currency}`;

  const safeSlug = code.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'product';
  return {
    productId: String(product?.id || ''),
    productName: String(product?.name || 'Unnamed Product').trim(),
    category: String(product?.category || 'General').trim(),
    unit: String(product?.unit || 'pcs').trim(),
    businessName: String(tenantInfo.name || 'AFRO Suite').trim(),
    barcodeValue: code,
    isGeneratedSku,
    priceText,
    includePrice,
    layout,
    copies,
    filename: `label-${safeSlug}.pdf`,
  };
}

function drawLabelContent(doc, { x, y, w, h, payload, encoded, drawCutBorder }) {
  if (drawCutBorder) {
    doc
      .save()
      .lineWidth(0.5)
      .dash(2, { space: 2 })
      .strokeColor('#CBD5E1')
      .rect(x, y, w, h)
      .stroke()
      .restore();
  }

  const padX = 7;
  const innerW = w - padX * 2;
  const topY = y + 6;

  // Store header & unit
  doc
    .font('Helvetica-Bold')
    .fontSize(5.5)
    .fillColor('#475569')
    .text(payload.businessName.toUpperCase(), x + padX, topY, {
      width: innerW * 0.7,
      lineBreak: false,
      ellipsis: true,
    });

  doc
    .font('Helvetica')
    .fontSize(5.5)
    .fillColor('#64748B')
    .text(payload.unit.toUpperCase(), x + padX + innerW * 0.7, topY, {
      width: innerW * 0.3,
      align: 'right',
      lineBreak: false,
      ellipsis: true,
    });

  // Product title
  doc
    .font('Helvetica-Bold')
    .fontSize(payload.layout === 'a4' ? 8 : 7.5)
    .fillColor('#0F172A')
    .text(payload.productName, x + padX, topY + 8, {
      width: innerW,
      height: 11,
      lineBreak: false,
      ellipsis: true,
    });

  // Vector Code 128B bars
  const barTop = topY + 21;
  const footerReserved = payload.includePrice ? 21 : 13;
  const barHeight = Math.max(20, h - (barTop - y) - footerReserved);
  const moduleW = innerW / encoded.totalModules;

  doc.save().fillColor('#000000');
  for (const bar of encoded.bars) {
    doc.rect(x + padX + bar.x * moduleW, barTop, bar.w * moduleW, barHeight).fill();
  }
  doc.restore();

  // Human-readable barcode digits / SKU
  const textY = barTop + barHeight + 2;
  doc
    .font('Courier-Bold')
    .fontSize(payload.layout === 'a4' ? 7 : 6.8)
    .fillColor('#0F172A')
    .text(encoded.value, x + padX, textY, {
      width: innerW,
      align: 'center',
      lineBreak: false,
      ellipsis: true,
    });

  if (payload.includePrice) {
    doc
      .font('Helvetica-Bold')
      .fontSize(payload.layout === 'a4' ? 7.5 : 7)
      .fillColor('#0F172A')
      .text(`${payload.priceText} / ${payload.unit}`, x + padX, textY + 8.5, {
        width: innerW,
        align: 'center',
        lineBreak: false,
        ellipsis: true,
      });
  }
}

/**
 * Renders a printable PDF (50x30mm thermal label pages OR A4 3x8 sticker sheet)
 * containing scannable vector Code 128B barcodes for physical labeling.
 */
export function generateBarcodeLabelPdfBuffer(payload) {
  return new Promise((resolve, reject) => {
    try {
      const encoded = encodeCode128B(payload.barcodeValue);

      if (payload.layout === 'a4') {
        // A4: 595.28 x 841.89 pt, 3 columns x 8 rows = 24 labels per sheet
        const doc = new PDFDocument({
          size: 'A4',
          margin: 0,
          info: {
            Title: `Barcode Labels - ${payload.productName}`,
            Author: payload.businessName,
            Subject: `Barcode ${encoded.value}`,
          },
        });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const cols = 3;
        const rows = 8;
        const perPage = cols * rows;
        const marginX = 22;
        const marginY = 26;
        const gapX = 10;
        const gapY = 8;
        const cellW = (595.28 - marginX * 2 - gapX * (cols - 1)) / cols;
        const cellH = (841.89 - marginY * 2 - gapY * (rows - 1)) / rows;

        for (let i = 0; i < payload.copies; i += 1) {
          if (i > 0 && i % perPage === 0) doc.addPage({ size: 'A4', margin: 0 });
          const slot = i % perPage;
          const col = slot % cols;
          const row = Math.floor(slot / cols);
          const x = marginX + col * (cellW + gapX);
          const y = marginY + row * (cellH + gapY);
          drawLabelContent(doc, {
            x,
            y,
            w: cellW,
            h: cellH,
            payload,
            encoded,
            drawCutBorder: true,
          });
        }
        doc.end();
        return;
      }

      // 50mm x 30mm standard thermal barcode label (141.73 x 85.04 pt)
      const labelW = 141.73;
      const labelH = 85.04;
      const doc = new PDFDocument({
        size: [labelW, labelH],
        margin: 0,
        info: {
          Title: `Barcode Label - ${payload.productName}`,
          Author: payload.businessName,
          Subject: `Barcode ${encoded.value}`,
        },
      });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      for (let i = 0; i < payload.copies; i += 1) {
        if (i > 0) doc.addPage({ size: [labelW, labelH], margin: 0 });
        drawLabelContent(doc, {
          x: 0,
          y: 0,
          w: labelW,
          h: labelH,
          payload,
          encoded,
          drawCutBorder: false,
        });
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
