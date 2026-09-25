import { useEffect, useRef, useState } from 'react'

interface ChatBarProps {
  onSend: (text: string) => void
  /** False when the player is not in a world; the bar stays out of the way. */
  enabled: boolean
  /** Driving input must be muted while typing, or WASD steers the car. */
  onTypingChange: (typing: boolean) => void
}

/**
 * Press T to talk. Deliberately tiny: it exists because shouting "watch this"
 * at a friend is half the point of the game, not because the game needs a chat
 * system.
 */
export function ChatBar({ onSend, enabled, onTypingChange }: ChatBarProps) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Leaving the session closes the bar; derived during render rather than in an
  // effect so there is no extra render pass.
  const visible = enabled && open
  if (!enabled && open) setOpen(false)

  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === 'KeyT' && !open && !event.repeat) {
        // Stop the T from also reaching the driving input.
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, open])

  useEffect(() => {
    if (visible) inputRef.current?.focus()
    onTypingChange(visible)
    return () => onTypingChange(false)
  }, [visible, onTypingChange])

  if (!visible) return null

  return (
    <form
      className="chatbar"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = text.trim().slice(0, 140)
        if (trimmed) onSend(trimmed)
        setText('')
        setOpen(false)
      }}
    >
      <span className="chatbar__label">SAY</span>
      <input
        ref={inputRef}
        value={text}
        maxLength={140}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            setText('')
            setOpen(false)
          }
        }}
      />
    </form>
  )
}
