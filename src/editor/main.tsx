import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BoardEditor } from './BoardEditor'
import { ErrorBoundary } from '../ui/components/ErrorBoundary'
import '../ui/styles/global.css'

const container = document.getElementById('root')
if (container === null) throw new Error('缺少 #root 挂载节点')

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary hint="录入的内容没有存盘。刷新页面后需要重新录入（建议先把 JSON 复制出来）。">
      <BoardEditor />
    </ErrorBoundary>
  </StrictMode>,
)
