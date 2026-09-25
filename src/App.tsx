import { useCallback, useEffect, useState } from 'react'
import { GameShell } from '@/components/GameShell'
import { MainMenu } from '@/components/menus/MainMenu'
import { getCurrentSession, isSupabaseConfigured, onAuthChange, signOut } from '@/lib/supabase/auth'
import { getSupabase } from '@/lib/supabase/client'
import { LocalPersistence } from '@/lib/persistence/LocalPersistence'
import { SupabasePersistence } from '@/lib/persistence/SupabasePersistence'
import type { PersistenceAdapter, PlayerSave } from '@/lib/persistence/types'
import { useGameStore } from '@/store/gameStore'
import '@/styles/global.css'
import '@/styles/menus.css'

export default function App() {
  const phase = useGameStore((s) => s.phase)
  const setPhase = useGameStore((s) => s.setPhase)
  const setSave = useGameStore((s) => s.setSave)
  const setAdapterStore = useGameStore((s) => s.setAdapter)
  const setError = useGameStore((s) => s.setError)

  const [adapter, setAdapter] = useState<PersistenceAdapter | null>(null)
  const [initialSave, setInitialSave] = useState<PlayerSave | null>(null)
  const [signedInAs, setSignedInAs] = useState<string | null>(null)

  // Track Supabase auth so the menu shows the right options.
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setPhase('menu')
      return
    }
    void getCurrentSession().then(({ user }) => {
      setSignedInAs((user?.user_metadata?.username as string | undefined) ?? user?.email ?? null)
      setPhase('menu')
    })
    return onAuthChange(({ user }) => {
      setSignedInAs((user?.user_metadata?.username as string | undefined) ?? user?.email ?? null)
    })
  }, [setPhase])

  const boot = useCallback(
    async (next: PersistenceAdapter) => {
      setPhase('loading')
      setError(null)
      try {
        const save = await next.load()
        setAdapter(next)
        setAdapterStore(next)
        setInitialSave(save)
        setSave(save)
        setPhase('playing')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load your profile')
        setPhase('menu')
      }
    },
    [setPhase, setSave, setAdapterStore, setError],
  )

  const playGuest = useCallback(() => {
    void boot(new LocalPersistence())
  }, [boot])

  const playSignedIn = useCallback(() => {
    void (async () => {
      const client = getSupabase()
      const { user } = await getCurrentSession()
      if (!client || !user) {
        setError('You are not signed in')
        return
      }
      await boot(new SupabasePersistence(client, user.id))
    })()
  }, [boot, setError])

  const quit = useCallback(() => {
    setAdapter(null)
    setInitialSave(null)
    setPhase('menu')
    useGameStore.setState({ overlay: null, hud: null, results: null })
  }, [setPhase])

  if (phase === 'playing' && adapter && initialSave) {
    return <GameShell adapter={adapter} initialSave={initialSave} onQuit={quit} />
  }

  if (phase === 'loading' || phase === 'boot') {
    return (
      <div className="loading">
        <div>
          <div className="loading__text">Loading</div>
          <div className="loading__bar">
            <span />
          </div>
        </div>
      </div>
    )
  }

  return (
    <MainMenu
      onPlayGuest={playGuest}
      onPlaySignedIn={playSignedIn}
      signedInAs={signedInAs}
      onSignOut={() => {
        void signOut()
        setSignedInAs(null)
      }}
    />
  )
}
