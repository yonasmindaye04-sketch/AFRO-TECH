import { useEffect, type FormEvent, type ReactNode } from 'react'

/* ── Layout helpers ─────────────────────────────────────── */

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }): JSX.Element {
  return (
    <div className="pl-page-head">
      <div>
        <h1 className="pl-page-title">{title}</h1>
        {subtitle && <p className="pl-page-sub">{subtitle}</p>}
      </div>
      {action && <div className="pl-page-actions">{action}</div>}
    </div>
  )
}

export function StatCard({ icon, label, value, tone }: { icon: string; label: string; value: string | number; tone?: string }): JSX.Element {
  return (
    <div className="pl-stat">
      <span className="pl-stat-icon" style={tone ? { color: tone, background: `${tone}1c` } : undefined}>
        <i className={icon} aria-hidden="true" />
      </span>
      <div>
        <span className="pl-stat-value">{value}</span>
        <span className="pl-stat-label">{label}</span>
      </div>
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={`pl-card ${className}`}>{children}</div>
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' }): JSX.Element {
  return <span className={`pl-badge pl-badge-${tone}`}>{children}</span>
}

export function Spinner({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <div className="pl-spinner-wrap" role="status">
      <span className="pl-spinner" />
      <span>{label}</span>
    </div>
  )
}

export function EmptyState({ icon = 'fa-solid fa-inbox', title, hint }: { icon?: string; title: string; hint?: string }): JSX.Element {
  return (
    <div className="pl-empty">
      <i className={icon} aria-hidden="true" />
      <p>{title}</p>
      {hint && <small>{hint}</small>}
    </div>
  )
}

export function ErrorBox({ message }: { message: string }): JSX.Element {
  return (
    <div className="pl-error-box" role="alert">
      <i className="fa-solid fa-circle-exclamation" aria-hidden="true" /> {message}
    </div>
  )
}

export function OkBox({ message }: { message: string }): JSX.Element {
  return (
    <div className="pl-ok-box" role="status">
      <i className="fa-solid fa-circle-check" aria-hidden="true" /> {message}
    </div>
  )
}

/* ── Table ──────────────────────────────────────────────── */

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  width?: string
}

export function DataTable<T>({ columns, rows, empty }: { columns: Column<T>[]; rows: T[]; empty?: string }): JSX.Element {
  if (!rows.length) return <EmptyState title={empty ?? 'Nothing here yet'} />
  return (
    <div className="pl-table-wrap">
      <table className="pl-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={c.width ? { width: c.width } : undefined} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={(row as { id?: string }).id ?? i}>
              {columns.map((c) => (
                <td key={c.key}>{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── Forms ──────────────────────────────────────────────── */

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}): JSX.Element {
  return (
    <label className="pl-field">
      <span className="pl-field-label">{label}</span>
      {children}
      {hint && <small className="pl-field-hint">{hint}</small>}
    </label>
  )
}

export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}): JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="pl-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`pl-modal ${wide ? 'pl-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="pl-modal-head">
          <h2>{title}</h2>
          <button type="button" className="pl-icon-btn" onClick={onClose} aria-label="Close dialog">
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>
        <div className="pl-modal-body">{children}</div>
      </div>
    </div>
  )
}

export function FormRow({ onSubmit, children, submitLabel, busy, error }: {
  onSubmit: (e: FormEvent) => void
  children: ReactNode
  submitLabel: string
  busy?: boolean
  error?: string | null
}): JSX.Element {
  return (
    <form onSubmit={onSubmit}>
      {children}
      {error && <ErrorBox message={error} />}
      <div className="pl-form-actions">
        <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
