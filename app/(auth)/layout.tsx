// Minimal layout for auth pages (login, register).
// No auth guard — these pages are intentionally accessible without a session.

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        minHeight: '100vh',
        background: '#f5f5f5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      {children}
    </div>
  )
}
