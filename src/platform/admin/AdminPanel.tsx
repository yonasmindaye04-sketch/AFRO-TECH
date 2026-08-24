import { useState } from 'react'
import { fmtDate, fmtMoney, api } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, DataTable, EmptyState, PageHeader, StatCard } from '../ui'

interface TenantRow {
  id: string
  name: string
  slug: string
  business_type: 'pharmacy' | 'store' | 'hospital' | 'school'
  status: 'trial' | 'active' | 'expired' | 'suspended'
  trial_ends_at: string
  trial_days_left: number
  owner_id: string | null
  owner_email: string | null
  owner_name: string | null
  created_at: string
}
interface AdminStats {
  by_type: Record<string, number>
  total_tenants: number
  active_tenants: number
  expiring_soon: number
}
interface AuditRow {
  id: string
  tenant_name: string | null
  user_name: string | null
  action: string
  entity: string
  details: Record<string, unknown> | null
  created_at: string
}

const TYPE_META: Record<string, { icon: string; label: string }> = {
  pharmacy: { icon: 'fa-solid fa-pills', label: 'Pharmacy' },
  store: { icon: 'fa-solid fa-store', label: 'Store' },
  hospital: { icon: 'fa-solid fa-hospital', label: 'Clinic' },
  school: { icon: 'fa-solid fa-graduation-cap', label: 'School' },
}

const statusTone = (s: TenantRow['status']): 'good' | 'warn' | 'bad' | 'neutral' =>
  s === 'active' ? 'good' : s === 'trial' ? 'warn' : s === 'expired' ? 'bad' : 'neutral'

export default function AdminPanel(): JSX.Element {
  const [search, setSearch] = useState('')
  const [showAudit, setShowAudit] = useState(false)
  const statsQ = useApiData<AdminStats>('/admin/stats')
  const tenantsQ = useApiData<{ tenants: TenantRow[]; total: number }>(`/admin/tenants?search=${encodeURIComponent(search)}&limit=100`)
  const auditQ = useApiData<{ logs: AuditRow[] }>(showAudit ? '/admin/audit?limit=60' : null)

  const setStatus = async (t: TenantRow, status: TenantRow['status']): Promise<void> => {
    const verb =
      status === 'suspended' ? `Suspend ${t.name}? Its users will lose access immediately.` : status === 'active' ? `Grant free full access to ${t.name}?` : null
    if (verb && !window.confirm(verb)) return
    try {
      await api.patch(`/admin/tenants/${t.id}`, { status })
      tenantsQ.reload()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Update failed')
    }
  }

  const extend = async (t: TenantRow): Promise<void> => {
    const input = window.prompt(`Extend access for ${t.name} by how many days?`)
    if (!input) return
    try {
      await api.post(`/admin/tenants/${t.id}/extend`, { days: Number(input) })
      tenantsQ.reload()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Extend failed')
    }
  }

  const resetOwnerPassword = async (t: TenantRow): Promise<void> => {
    if (!t.owner_id) {
      window.alert('This company has no owner account linked.')
      return
    }
    const pw = window.prompt(`Set a temporary password for ${t.owner_name ?? 'the owner'} (${t.owner_email}):`)
    if (!pw) return
    if (pw.length < 8) {
      window.alert('Password must be at least 8 characters.')
      return
    }
    try {
      await api.post(`/admin/users/${t.owner_id}/reset-password`, { new_password: pw })
      window.alert(`Password updated for ${t.owner_email}. Share it privately.`)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Reset failed')
    }
  }

  return (
    <div>
      <PageHeader title="AFRO-TECH Admin" subtitle="All companies across the platform" />

      <div className="pl-admin-stats">
        <StatCard icon="fa-solid fa-building" label="Total companies" value={statsQ.data?.total_tenants ?? '—'} />
        <StatCard icon="fa-solid fa-circle-check" label="With access" value={statsQ.data?.active_tenants ?? '—'} tone="#34d399" />
        <StatCard icon="fa-solid fa-hourglass-half" label="Trials ending ≤7d" value={statsQ.data?.expiring_soon ?? '—'} tone="#e07a7a" />
        {(statsQ.data ? Object.entries(statsQ.data.by_type) : []).map(([type, n]) => (
          <StatCard key={type} icon={TYPE_META[type]?.icon ?? 'fa-solid fa-briefcase'} label={TYPE_META[type]?.label ?? type} value={n} />
        ))}
      </div>

      <div className="pl-toolbar">
        <input className="pl-input pl-search-lg" placeholder="Search company name…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search companies" />
        <span style={{ color: 'var(--text-dim)', fontSize: '.85rem' }}>{tenantsQ.data?.total ?? 0} companies</span>
        <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setShowAudit((v) => !v)}>
          <i className="fa-solid fa-clipboard-list" aria-hidden="true" /> {showAudit ? 'Hide audit log' : 'Platform audit log'}
        </button>
      </div>

      {showAudit && (
        <div className="pl-card" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <h2>Recent activity across all workspaces</h2>
          {auditQ.loading ? (
            <p style={{ color: 'var(--text-dim)' }}>Loading…</p>
          ) : (auditQ.data?.logs.length ?? 0) === 0 ? (
            <p style={{ color: 'var(--text-dim)' }}>No activity recorded yet.</p>
          ) : (
            <div className="pl-table-wrap">
              <table className="pl-table" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Company</th>
                    <th>User</th>
                    <th>Action</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {(auditQ.data?.logs ?? []).map((l) => (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{new Date(l.created_at).toLocaleString()}</td>
                      <td>{l.tenant_name ?? '—'}</td>
                      <td>{l.user_name ?? '—'}</td>
                      <td>
                        <code style={{ fontSize: '.78rem', color: 'var(--accent)' }}>{l.action}</code>
                      </td>
                      <td>
                        <small style={{ color: 'var(--text-dim)' }}>
                          {l.details ? JSON.stringify(l.details).slice(0, 80) : l.entity}
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tenantsQ.loading ? (
        <EmptyState title="Loading…" />
      ) : !tenantsQ.data?.tenants.length ? (
        <EmptyState icon="fa-solid fa-building" title="No companies registered yet" hint="Companies self-register from /app/register." />
      ) : (
        <DataTable
          rows={tenantsQ.data.tenants}
          columns={[
            {
              key: 'name',
              header: 'Company',
              render: (t) => (
                <div>
                  <strong>
                    <i className={`${TYPE_META[t.business_type]?.icon ?? 'fa-solid fa-briefcase'} fa-fw`} style={{ color: 'var(--accent)', marginRight: 8 }} aria-hidden="true" />
                    {t.name}
                  </strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)', marginLeft: 26 }}>
                    {t.owner_name ?? '—'} · {t.owner_email ?? ''}
                  </small>
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              width: '110px',
              render: (t) => <Badge tone={statusTone(t.status)}>{t.status}</Badge>,
            },
            {
              key: 'trial',
              header: 'Access until',
              render: (t) => (
                <>
                  {fmtDate(t.trial_ends_at)}
                  {t.status === 'trial' && t.trial_days_left <= 7 && (
                    <Badge tone="bad">{t.trial_days_left}d left</Badge>
                  )}
                </>
              ),
            },
            { key: 'since', header: 'Registered', render: (t) => fmtDate(t.created_at), width: '105px' },
            {
              key: 'act',
              header: '',
              width: '280px',
              render: (t) => (
                <div className="pl-row-actions">
                  <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => extend(t)}>
                    Extend…
                  </button>
                  {t.status !== 'active' ? (
                    <button type="button" className="pl-btn pl-btn-sm" style={{ background: 'rgba(52,211,153,.14)', color: '#34d399' }} onClick={() => setStatus(t, 'active')}>
                      Grant access
                    </button>
                  ) : (
                    <button type="button" className="pl-icon-btn danger" aria-label={`Suspend ${t.name}`} onClick={() => setStatus(t, 'suspended')}>
                      <i className="fa-solid fa-pause" aria-hidden="true" />
                    </button>
                  )}
                  {t.status === 'suspended' && (
                    <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => setStatus(t, 'trial')}>
                      Resume trial
                    </button>
                  )}
                  <button type="button" className="pl-icon-btn" aria-label={`Reset password for ${t.owner_email ?? 'owner'}`} title="Reset owner password" onClick={() => resetOwnerPassword(t)}>
                    <i className="fa-solid fa-key" aria-hidden="true" />
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

      <p style={{ color: 'var(--text-dim)', fontSize: '.82rem', marginTop: 18 }}>
        <i className="fa-solid fa-circle-info" aria-hidden="true" /> Subscriptions & online payments come later — for now, grant or extend access manually.
        Platform revenue to date is tracked outside this panel ({fmtMoney(0)} placeholder).
      </p>
    </div>
  )
}
