import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { TextContextMenu } from './components/ui/TextContextMenu'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TextContextMenu />
    <App />
  </React.StrictMode>
)
