import { Component, type ReactNode } from 'react'

// D6 修复：渲染级错误边界 + WebGL 上下文丢失提示。
// 出故障时给出克制的中式大屏提示与重载入口，而不是白屏/整页崩溃。
interface Props { children: ReactNode }
interface State { error: string | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(e: unknown): State {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  componentDidCatch(e: unknown) {
    console.error('[AEOLUS] render error:', e)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="fatal">
          <div className="fatal-card">
            <h2>数字孪生渲染异常</h2>
            <p>3D 场景初始化失败（可能是浏览器 WebGL 环境不支持）。</p>
            <code>{this.state.error.slice(0, 220)}</code>
            <button onClick={() => location.reload()}>重新加载</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
