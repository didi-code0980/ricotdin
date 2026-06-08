import Link from 'next/link'

export default function Home() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 520,
        margin: '0 auto',
        padding: '4rem 1rem',
        textAlign: 'center',
      }}
    >
      <h1 style={{ marginBottom: 8 }}>Meeting Assistant</h1>
      <p style={{ color: '#666', marginBottom: '2rem' }}>
        Record meetings · get transcripts, summaries, and to-dos.
      </p>
      <div
        style={{
          display: 'flex',
          gap: 12,
          justifyContent: 'center',
          flexWrap: 'wrap',
        }}
      >
        <Link
          href="/record"
          style={{
            padding: '10px 24px',
            background: '#1a7f37',
            color: '#fff',
            borderRadius: 8,
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: 15,
          }}
        >
          ● New recording
        </Link>
        <Link
          href="/meetings"
          style={{
            padding: '10px 24px',
            background: '#f5f5f5',
            color: '#333',
            borderRadius: 8,
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: 15,
            border: '1px solid #ddd',
          }}
        >
          All meetings
        </Link>
      </div>
    </main>
  )
}
