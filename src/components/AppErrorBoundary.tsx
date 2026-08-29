import { Component, type ErrorInfo, type PropsWithChildren } from 'react'
import { Button, View } from '@tarojs/components'
import Taro from '@tarojs/taro'

interface ErrorBoundaryState {
  failed: boolean
  message: string
}

export class AppErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false, message: '' }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { failed: true, message: error instanceof Error ? error.message : '页面暂时无法显示。' }
  }

  componentDidCatch(_error: unknown, _info: ErrorInfo) {
    // 不上传用户战史、证据或身份信息；后续接入遥测时只记录脱敏错误码。
  }

  private retry = () => {
    this.setState({ failed: false, message: '' })
    Taro.reLaunch({ url: '/pages/command/index' }).catch(() => undefined)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <View className='app-error-boundary'>
        <View className='eyebrow'>FIELD RECOVERY · 应急整备</View>
        <View className='page-title'>军报暂时无法展开</View>
        <View className='page-subtitle'>{this.state.message}</View>
        <View className='app-error-hint'>主存档异常时系统会优先尝试最近的安全快照；你也可以前往战史页手动恢复备份。</View>
        <Button className='primary-button' onClick={this.retry}>重新进入司令部</Button>
      </View>
    )
  }
}
