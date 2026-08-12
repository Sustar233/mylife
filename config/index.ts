import { defineConfig, type UserConfigExport } from '@tarojs/cli'

const config: UserConfigExport<'webpack5'> = {
  projectName: 'zhiyu',
  date: '2026-8-9',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2
  },
  sourceRoot: 'src',
  outputRoot: process.env.TARO_ENV === 'h5' ? 'dist/h5' : 'dist/weapp',
  framework: 'react',
  compiler: 'webpack5',
  cache: { enable: true },
  plugins: [],
  defineConstants: {},
  copy: { patterns: [], options: {} },
  mini: {
    postcss: {
      pxtransform: { enable: true, config: {} },
      url: { enable: true, config: { limit: 1024 } },
      cssModules: { enable: false, config: { namingPattern: 'module', generateScopedName: '[name]__[local]___[hash:base64:5]' } }
    }
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    postcss: {
      autoprefixer: { enable: true, config: {} },
      cssModules: { enable: false, config: { namingPattern: 'module', generateScopedName: '[name]__[local]___[hash:base64:5]' } }
    }
  }
}

export default defineConfig(config)
