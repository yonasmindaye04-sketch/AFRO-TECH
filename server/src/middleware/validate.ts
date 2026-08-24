import type { NextFunction, Request, Response } from 'express'
import { ZodError, type ZodSchema } from 'zod'
import { AppError } from '../utils/helpers.js'

export function validateBody<T extends ZodSchema>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      const first = result.error.issues[0]
      const msg = first ? `${first.path.join('.') || 'field'}: ${first.message}` : 'Invalid request body'
      return next(new AppError(400, msg, 'VALIDATION'))
    }
    req.body = result.data
    next()
  }
}

export function notFound(req: Request, res: Response): void {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found`, code: 'NOT_FOUND' })
}

// Express error handlers must have 4 params even when the last is unused.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, code: err.code })
    return
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid data', code: 'VALIDATION' })
    return
  }
  // Postgres errors → friendly messages
  const pgErr = err as { code?: string; detail?: string; constraint?: string }
  if (pgErr?.code === '23505' || pgErr?.code === '23P01') {
    res.status(409).json({ error: 'This record conflicts with an existing entry', code: 'DUPLICATE' })
    return
  }
  if (pgErr?.code === '23503') {
    res.status(409).json({ error: 'Related record is missing or still in use', code: 'FK_VIOLATION' })
    return
  }
  console.error('[api] unexpected error:', err)
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.', code: 'INTERNAL' })
}
