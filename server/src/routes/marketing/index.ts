import { Router } from 'express'
import contacts from './contacts.js'
import audiences from './audiences.js'
import templates from './templates.js'
import campaigns from './campaigns.js'
import webhooks from './webhooks.js'
import analytics from './analytics.js'

const router = Router()

router.use('/contacts', contacts)
router.use('/audiences', audiences)
router.use('/templates', templates)
router.use('/campaigns', campaigns)
router.use('/webhooks', webhooks)
router.use('/analytics', analytics)

export default router