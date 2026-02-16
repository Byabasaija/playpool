import ReactDOM from 'react-dom/client'
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