import { useLocation, useNavigate } from 'react-router-dom'

const TABS = [
  { to: '/app/marketing', label: 'Overview', icon: 'fa-solid fa-gauge-high', end: true },
  { to: '/app/marketing/contacts', label: 'Contacts', icon: 'fa-solid fa-users' },
  { to: '/app/marketing/audiences', label: 'Audiences', icon: 'fa-solid fa-layer-group' },
  { to: '/app/marketing/templates', label: 'Templates', icon: 'fa-solid fa-file-lines' },
  { to: '/app/marketing/campaigns', label: 'Campaigns', icon: 'fa-solid fa-bullhorn' },
  { to: '/app/marketing/analytics', label: 'Analytics', icon: 'fa-solid fa-chart-line' },
]

/** Tab bar shown on every marketing page so all sub-pages are reachable. */
export default function MarketingNav(): JSX.Element {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <div className="pl-seg" role="tablist" aria-label="Marketing sections" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
      {TABS.map((t) => {
        const active = t.end ? pathname === t.to : pathname.startsWith(t.to)
        return (
          <button key={t.to} type="button" role="tab" aria-selected={active} className={active ? 'on' : ''} onClick={() => navigate(t.to)}>
            <i className={t.icon} aria-hidden="true" style={{ marginRight: 6 }} />
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
