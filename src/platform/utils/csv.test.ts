import test from 'node:test'
import assert from 'node:assert/strict'
import { fmtMoney, fmtDate } from '../api'

test('fmtMoney formats numeric and string values cleanly', () => {
  assert.equal(fmtMoney(0), '0')
  assert.equal(fmtMoney(1250.5), '1,250.5')
  assert.equal(fmtMoney('48200'), '48,200')
  assert.equal(fmtMoney(null), '0')
  assert.equal(fmtMoney(undefined), '0')
})

test('fmtDate handles null/empty and ISO date strings', () => {
  assert.equal(fmtDate(null), '—')
  assert.equal(fmtDate(undefined), '—')
  const formatted = fmtDate('2026-05-15T10:00:00.000Z')
  assert.match(formatted, /2026/)
})
