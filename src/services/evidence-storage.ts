import Taro from '@tarojs/taro'

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * 本地模式下把临时图片转换为可跨重启保存的地址。
 * H5 保存为 data URL；微信小程序复制到应用持久文件目录。
 * CloudBase 仓储启用后，这里可替换为云存储 fileID。
 */
export async function persistEvidenceImage(tempPath: string): Promise<string> {
  try {
    if (process.env.TARO_ENV === 'h5') {
      const response = await fetch(tempPath)
      if (!response.ok) return tempPath
      return await blobToDataUrl(await response.blob())
    }
    if (process.env.TARO_ENV === 'weapp') {
      const result = await Taro.saveFile({ tempFilePath: tempPath })
      return 'savedFilePath' in result ? String(result.savedFilePath) : tempPath
    }
  } catch {
    return tempPath
  }
  return tempPath
}
