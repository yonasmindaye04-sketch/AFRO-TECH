export default function Spinner({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <div className="pl-spinner-wrap" role="status">
      <span className="pl-spinner" />
      <span>{label}</span>
    </div>
  )
}
