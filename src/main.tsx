import { createRoot } from 'react-dom/client'
import App from './App'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

// No StrictMode: its double-mount would create a second WebGL context on the
// same canvas after the first is disposed, which browsers refuse. The engine is
// deliberately mounted exactly once.
createRoot(container).render(<App />)
