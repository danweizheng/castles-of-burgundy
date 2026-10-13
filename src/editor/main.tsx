import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BoardEditor } from './BoardEditor'
import '../ui/styles/global.css'

const container = document.getElementById('root')
if (container === null) throw new Error('缺少 #root 挂载节点')

createRoot(container).render(
  <StrictMode>
    <BoardEditor />
  </StrictMode>,
)
