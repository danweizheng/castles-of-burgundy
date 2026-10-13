import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { ErrorBoundary } from './ui/components/ErrorBoundary'
import './ui/styles/global.css'

const container = document.getElementById('root')
if (container === null) throw new Error('缺少 #root 挂载节点')

createRoot(container).render(
  <StrictMode>
    {/* 兜底边界要在最外层：任何一处未捕获异常都不该变成白屏 */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
