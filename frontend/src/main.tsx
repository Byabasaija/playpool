import ReactDOM from 'react-dom/client'

// Register service worker — required for Chrome to fire beforeinstallprompt
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'
import { SoundProvider } from './components/SoundProvider.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <SoundProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </SoundProvider>,
)