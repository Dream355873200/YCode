// 错误边界：renderer 组件抛异常时显示错误而不是黑屏
import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: 'var(--err)', fontFamily: 'Consolas, monospace', fontSize: 13, whiteSpace: 'pre-wrap' }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>界面出错：</div>
          {String(this.state.error && this.state.error.stack || this.state.error)}
          <div style={{ marginTop: 16 }}>
            <button className="btn" onClick={() => this.setState({ error: null })}>重试</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
