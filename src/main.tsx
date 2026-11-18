import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const url = new URL(`${import.meta.env.BASE_URL}sw.js`, document.baseURI)
    void navigator.serviceWorker.register(url).catch(() => { /* The live app works without offline support. */ })
  })
}
