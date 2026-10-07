#!/usr/bin/env node
/**
 * One-shot: seal any legacy plaintext bot tokens into bot_token_enc.
 *
 * Rows written before migration 034 still hold the token in tenant_bots.bot_token.
 * Safe to run repeatedly — it only touches rows that still have plaintext, and
 * leaves already-sealed rows alone.
 *
 * Requires BOT_TOKEN_ENCRYPTION_KEY. Run migrations first:
 *   npm run migrate && npx tsx server/src/scripts/seal-bot-tokens.ts
 */
import 'dotenv/config'
import { pool, query } from '../config/db.js'
import { decryptSecret, encryptionConfigured, encryptSecret } from '../utils/crypto.js'

async function run(): Promise<void> {
  if (!encryptionConfigured()) {
    console.error('BOT_TOKEN_ENCRYPTION_KEY is not set — refusing to run.')
    process.exit(1)
  }

  const rows = await query<{ id: string; token: string }>(
    `SELECT id, bot_token AS token FROM tenant_bots
     WHERE bot_token IS NOT NULL AND bot_token NOT LIKE 'v1.%'`
  )

  let sealed = 0
  for (const row of rows) {
    // Guard against double-sealing if someone re-ran with a different key.
    const plaintext = decryptSecret(row.token)
    await query(
      `UPDATE tenant_bots SET bot_token_enc = $2, bot_token = NULL, updated_at = now() WHERE id = $1`,
      [row.id, encryptSecret(plaintext)]
    )
    sealed++
    console.log(`sealed bot ${row.id}`)
  }

  console.log(sealed ? `Sealed ${sealed} bot token(s).` : 'Nothing to seal — all tokens already encrypted.')
  await pool.end()
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})