import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProductLabelPayload,
  encodeCode128B,
  generateBarcodeLabelPdfBuffer,
  resolveProductBarcodeValue,
} from './barcodeLabelService.js';

test('encodeCode128B produces valid Code 128B bars with quiet zones and Mod-103 checksum', () => {
  const encoded = encodeCode128B('6001234567890');
  assert.equal(encoded.value, '6001234567890');
  // 1 Start (11) + 13 chars (13*11) + 1 checksum (11) + 1 Stop (13) + 2*10 quiet zones = 188 modules
  assert.equal(encoded.totalModules, 10 + 11 + 13 * 11 + 11 + 13 + 10);
  // Each of 15 non-stop symbols has 3 bars + stop has 4 bars = 49 bars
  assert.equal(encoded.bars.length, 49);
  assert.equal(encoded.bars[0].x, 10);
});

test('resolveProductBarcodeValue uses product barcode or falls back to deterministic SKU', () => {
  assert.deepEqual(
    resolveProductBarcodeValue({ id: 'prod-1', barcode: ' 6001234567890 ' }),
    { code: '6001234567890', isGeneratedSku: false },
  );
  assert.deepEqual(
    resolveProductBarcodeValue({ id: 'prod-abc-99', barcode: null }),
    { code: 'SKU-PRODABC99', isGeneratedSku: true },
  );
});

test('buildProductLabelPayload clamps copies and builds clean filename and price', () => {
  const payload = buildProductLabelPayload(
    { id: 'prod-1', name: 'Amoxicillin 500mg', unit: 'box', sell_price: '420', barcode: '6001234567890' },
    { name: 'Bole Medhanealem Pharmacy', currency: 'ETB' },
    { layout: 'a4', copies: 99, includePrice: true },
  );
  assert.equal(payload.layout, 'a4');
  assert.equal(payload.copies, 60);
  assert.equal(payload.filename, 'label-6001234567890.pdf');
  assert.equal(payload.priceText, '420 ETB');
  assert.equal(payload.includePrice, true);
});

test('generateBarcodeLabelPdfBuffer outputs valid PDF binary for both thermal and A4 sheet layouts', async () => {
  const thermalPayload = buildProductLabelPayload(
    { id: 'prod-1', name: 'Amoxicillin 500mg Capsule', unit: 'box', sell_price: '420', barcode: '6001234567890' },
    { name: 'Bole Medhanealem Pharmacy', currency: 'ETB' },
    { layout: 'thermal', copies: 2, includePrice: true },
  );
  const thermalPdf = await generateBarcodeLabelPdfBuffer(thermalPayload);
  assert.ok(Buffer.isBuffer(thermalPdf));
  assert.ok(thermalPdf.length > 1000);
  assert.equal(thermalPdf.subarray(0, 5).toString('ascii'), '%PDF-');

  const a4Payload = buildProductLabelPayload(
    { id: 'prod-2', name: 'Paracetamol 500mg Tablet', unit: 'strip', sell_price: '85', barcode: '' },
    { name: 'Bole Medhanealem Pharmacy', currency: 'ETB' },
    { layout: 'a4', copies: 26, includePrice: false },
  );
  const a4Pdf = await generateBarcodeLabelPdfBuffer(a4Payload);
  assert.ok(a4Pdf.length > 1200);
  assert.equal(a4Pdf.subarray(0, 5).toString('ascii'), '%PDF-');
});
