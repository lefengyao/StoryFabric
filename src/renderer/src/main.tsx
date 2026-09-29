import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { TextContextMenu } from './components/ui/TextContextMenu'
import './styles/index.css'

if (window.Capacitor?.isNativePlatform?.()) document.documentElement.classList.add('android-native')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TextContextMenu />
    <App />
  </React.StrictMode>
)
