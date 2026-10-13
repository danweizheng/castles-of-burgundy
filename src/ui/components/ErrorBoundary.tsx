import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * 兜底错误边界。
 *
 * 为什么必须有：这是一个要在**飞机上离线玩**的应用。没有错误边界时，
 * 任何一处未捕获异常（包括事件处理器里抛出的）都会让 React 卸载整棵树 ——
 * 对玩家来说就是**白屏，而且没有任何恢复入口**。
 *
 * 好消息是对局本身不会丢：存档在 IndexedDB 里，刷新页面会恢复到最近一次保存的局面。
 * 所以这个界面要做的只有一件事：**把这句话告诉玩家，并给出重新加载的按钮。**
 *
 * 注意事件处理器里抛出的异常在 React 18 里也会冒到根边界，
 * 所以它不只是"渲染出错"的兜底。
 */

export interface ErrorBoundaryProps {
  readonly children: ReactNode
  /** 出错时额外提示（录入器与对局页的重启建议不同） */
  readonly hint?: string
}

interface ErrorBoundaryState {
  readonly error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 保留在控制台，方便事后查；界面上只给玩家必要信息
    console.error('界面出错：', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children

    return (
      <div className="crash">
        <h1 className="crash__title">界面出错了</h1>
        <p className="crash__text">
          {this.props.hint ?? '对局存档还在。点下面的按钮刷新页面，就能回到最近一次保存的局面。'}
        </p>
        <p className="crash__detail">{error.message}</p>
        <div className="crash__buttons">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => window.location.reload()}
          >
            刷新并恢复对局
          </button>
          <button
            type="button"
            className="btn"
            // 有些错误是瞬时的（比如陈旧动作），清掉错误状态可以就地继续，不必刷新
            onClick={() => this.setState({ error: null })}
          >
            尝试继续
          </button>
        </div>
      </div>
    )
  }
}
