import { useState, type FormEvent } from 'react'
import { isSupabaseConfigured, signIn, signUp } from '@/lib/supabase/auth'
import { useGameStore } from '@/store/gameStore'
import '@/styles/menus.css'

interface MainMenuProps {
  onPlayGuest: () => void
  onPlaySignedIn: () => void
  signedInAs: string | null
  onSignOut: () => void
}

export function MainMenu({ onPlayGuest, onPlaySignedIn, signedInAs, onSignOut }: MainMenuProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [pending, setPending] = useState(false)
  const error = useGameStore((s) => s.error)
  const setError = useGameStore((s) => s.setError)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      if (mode === 'signup') {
        await signUp(email, password, username.trim() || 'Driver')
      } else {
        await signIn(email, password)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="screen">
      <div className="screen__inner">
        <div className="brand">
          <h1 className="brand__title">CRASHOUT</h1>
          <p className="brand__tagline">Open-world car chaos</p>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {signedInAs ? (
          <div className="card">
            <h2 className="card__title">Welcome back, {signedInAs}</h2>
            <p className="card__subtitle">Your garage, credits and progress are saved to your account.</p>
            <div className="stack">
              <button className="btn btn--primary btn--block" onClick={onPlaySignedIn}>
                Drive
              </button>
              <button className="btn btn--ghost btn--block" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="card">
              <h2 className="card__title">Jump straight in</h2>
              <p className="card__subtitle">
                Play as a guest. Progress is stored in this browser, and other tabs on this computer can
                join your world.
              </p>
              <button className="btn btn--primary btn--block" onClick={onPlayGuest}>
                Play as guest
              </button>
            </div>

            {isSupabaseConfigured ? (
              <div className="card">
                <div className="tabs">
                  <button
                    className={`tab ${mode === 'signin' ? 'tab--active' : ''}`}
                    onClick={() => setMode('signin')}
                  >
                    Sign in
                  </button>
                  <button
                    className={`tab ${mode === 'signup' ? 'tab--active' : ''}`}
                    onClick={() => setMode('signup')}
                  >
                    Create account
                  </button>
                </div>
                <p className="card__subtitle">
                  An account saves your garage across devices and lets friends on other computers join
                  your world.
                </p>
                <form className="stack" onSubmit={submit}>
                  {mode === 'signup' && (
                    <div className="field">
                      <label htmlFor="username">Driver name</label>
                      <input
                        id="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        maxLength={24}
                        placeholder="Speedy"
                      />
                    </div>
                  )}
                  <div className="field">
                    <label htmlFor="email">Email</label>
                    <input
                      id="email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="password">Password</label>
                    <input
                      id="password"
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    />
                  </div>
                  <button className="btn btn--block" type="submit" disabled={pending}>
                    {pending ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
                  </button>
                </form>
              </div>
            ) : (
              <div className="card">
                <h2 className="card__title">Accounts are off</h2>
                <p className="card__subtitle" style={{ margin: 0 }}>
                  Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to enable
                  accounts, cloud saves and multiplayer across the internet. See{' '}
                  <code>README.md</code>.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
