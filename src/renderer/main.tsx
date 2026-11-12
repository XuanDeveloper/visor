import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Popover } from './components/Popover'
import './styles/global.css'

/**
 * Duas superfícies, um bundle. O main carrega esta mesma página com
 * `?mode=popover` (painel da bandeja) ou `?mode=panel` (janela completa).
 */
const mode = new URLSearchParams(location.search).get('mode') ?? 'panel'

/**
 * Fora do Electron (`npx vite --config vite.preview.config.ts`) não existe
 * preload, então instalamos o harness de dados falsos para trabalhar no visual
 * no navegador. Dentro do Electron esse ramo nunca roda.
 */
let applyViewFromQuery: (() => void) | undefined
if (!window.visor) {
  const mock = await import('./lib/mockApi')
  mock.installMockApi()
  applyViewFromQuery = mock.applyViewFromQuery
}

// A janela do painel é transparente: a casca arredondada é desenhada pelo CSS.
if (mode === 'popover') document.body.classList.add('is-popover')

const root = document.getElementById('root')
if (!root) throw new Error('#root não encontrado no index.html')

createRoot(root).render(
  <StrictMode>{mode === 'popover' ? <Popover /> : <App />}</StrictMode>
)

applyViewFromQuery?.()
