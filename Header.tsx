type HeaderProps = {
  onRefresh?: () => void
}

export function Header({ onRefresh }: HeaderProps) {
  return (
    <header style={{ padding: 16, borderBottom: '1px solid var(--bg-border)' }}>
      <button onClick={onRefresh}>Refresh</button>
    </header>
  )
}
