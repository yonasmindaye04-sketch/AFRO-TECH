export interface TopbarNavItem {
  to: string
  label: string
  icon: string
  end?: boolean
}

export interface WorkspaceAlert {
  id: string
  title: string
  detail: string
  severity: 'info' | 'warn' | 'bad'
  route: string
  icon: string
}

export function resolvePageTitle(pathname: string, navItems: TopbarNavItem[]): string {
  const clean = pathname.replace(/\/+$/, '') || '/app'
  const exact = navItems.find((item) => item.to === clean)
  if (exact) return exact.label

  // Match nested routes (e.g. /app/teachers/12 -> Classes & Teachers)
  const prefixMatch = navItems
    .filter((item) => item.to !== '/app' && clean.startsWith(`${item.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0]
  if (prefixMatch) return prefixMatch.label

  const staticTitles: Record<string, string> = {
    '/app': 'Dashboard',
    '/app/users': 'Team',
    '/app/settings': 'Settings',
    '/app/bot-studio': 'My Telegram Bot',
    '/app/marketing': 'Marketing',
    '/app/subscription': 'Subscription',
  }
  if (staticTitles[clean]) return staticTitles[clean]
  return 'Workspace'
}

export function filterQuickSearchItems<T extends { label: string; to: string }>(
  items: T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter(
    (item) => item.label.toLowerCase().includes(q) || item.to.toLowerCase().includes(q)
  )
}

export function countUnreadAlerts(alerts: WorkspaceAlert[], readIds: Iterable<string>): number {
  const readSet = new Set(readIds)
  return alerts.reduce((count, alert) => (readSet.has(alert.id) ? count : count + 1), 0)
}
