import { useState, useEffect, useDeferredValue, type FormEvent, type ReactNode } from 'react'

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
      <span className="pl-stat-icon" style={tone ? { color: tone } : undefined}>
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

/* ── Search ─────────────────────────────────────────────── */

/** Shared search input: same icon, padding, and placeholder style everywhere. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className = '',
  style,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
  style?: React.CSSProperties
}): JSX.Element {
  return (
    <span className={`pl-search ${className}`} style={style}>
      <i className="fa-solid fa-search" aria-hidden="true" />
      <input
        type="text"
        className="pl-input"
        placeholder={placeholder ?? 'Search…'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel ?? placeholder ?? 'Search'}
      />
    </span>
  )
}

/* ── Table ──────────────────────────────────────────────── */

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  width?: string
  /** Optional text extractor used for search matching; defaults to the row's value for `key`. */
  searchText?: (row: T) => string
}

export function DataTable<T>({
  columns,
  rows,
  empty,
  searchable = true,
  searchPlaceholder,
}: {
  columns: Column<T>[]
  rows: T[]
  empty?: string
  searchable?: boolean
  searchPlaceholder?: string
}): JSX.Element {
  const [searchQuery, setSearchQuery] = useState('')
  const deferredQuery = useDeferredValue(searchQuery)

  if (!rows.length && !searchQuery) return <EmptyState title={empty ?? 'Nothing here yet'} />

  const filteredRows = !deferredQuery.trim()
    ? rows
    : rows.filter((row) => {
        const q = deferredQuery.toLowerCase()
        return columns.some((c) => {
          const text = c.searchText ? c.searchText(row) : String((row as Record<string, unknown>)[c.key] ?? '')
          return text.toLowerCase().includes(q)
        })
      })

  return (
    <div className="pl-table-container" style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
      {searchable && rows.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={searchPlaceholder ?? 'Search…'}
            style={{ width: '100%', maxWidth: '260px' }}
          />
        </div>
      )}
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
            {filteredRows.length > 0 ? (
              filteredRows.map((row, i) => (
                <tr key={(row as { id?: string }).id ?? i}>
                  {columns.map((c) => (
                    <td key={c.key}>{c.render(row)}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '32px' }}>
                  <span style={{ color: 'var(--text-dim)' }}>No results found for "{searchQuery}"</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
