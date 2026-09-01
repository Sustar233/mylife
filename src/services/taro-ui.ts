import Taro from '@tarojs/taro'

export type UserToastIcon = 'success' | 'none'

interface ConfirmationOptions {
  title: string
  content: string
  confirmText?: string
  confirmColor?: string
}

export function showUserToast(title: string, icon: UserToastIcon = 'none'): void {
  void Taro.showToast({ title, icon }).catch(() => undefined)
}

export async function confirmAction(options: ConfirmationOptions): Promise<boolean> {
  try {
    return (await Taro.showModal(options)).confirm
  } catch {
    showUserToast('确认窗口打开失败')
    return false
  }
}

export function openPage(url: string): void {
  void Taro.navigateTo({ url }).catch(() => showUserToast('页面打开失败，请重试'))
}

export function openTab(url: string): void {
  void Taro.switchTab({ url }).catch(() => showUserToast('页面切换失败，请重试'))
}

export function goBack(fallbackUrl = '/pages/command/index'): void {
  void Taro.navigateBack().catch(() => {
    void Taro.switchTab({ url: fallbackUrl }).catch(() => showUserToast('返回失败，请重试'))
  })
}

export async function copyText(data: string): Promise<void> {
  try {
    await Taro.setClipboardData({ data })
  } catch {
    showUserToast('复制失败，请手动复制')
  }
}
