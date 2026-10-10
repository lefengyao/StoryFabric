import './platform/legacyWebView'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { TextContextMenu } from './components/ui/TextContextMenu'
import './styles/index.css'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&url'
import { configurePdfWorker } from '../../core/inspiration/pdfWorkerConfig'
import { initializeAndroidKeyboard } from './platform/androidKeyboard'

configurePdfWorker(pdfWorkerUrl)

if (window.Capacitor?.isNativePlatform?.()) {
  document.documentElement.classList.add('android-native')
  initializeAndroidKeyboard()
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TextContextMenu />
    <App />
  </React.StrictMode>
)
