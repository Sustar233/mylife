# 知域 1.0

把学习目标转化为策略战棋的个人学习规划应用。一套 React + TypeScript 代码可构建为微信小程序和 H5 网页。

## 已实现

- 语言、证书考试、数理与编程三套战役模板
- 最多三场并行战役，以及既有能力领地导入
- 连片行政区地图、政治/稳定双图层、补给道路、前线与围城进度
- 15/25/45/60 分钟时间棋子与可暂停、可恢复计时
- 达成、部分达成、未达成三种结算
- 文字、链接和持久化图片成果证据
- 1/3/7/14/30 天复习计划、48 小时宽限和每周衰减
- 敌军反攻、既有能力反叛、失地收复和 14 天休整令
- 司令部、世界地图、战史三个主入口
- 本地持久化、重复结算保护和完整领域测试

## 本地运行

```bash
npm install
npm run dev:h5
```

默认 H5 开发地址会显示在终端中。生产构建：

```bash
npm run build:h5
npm run build:weapp
```

H5 产物位于 `dist/h5`，微信小程序产物位于 `dist/weapp`。用微信开发者工具打开项目根目录即可；正式调试前请将 [project.config.json](./project.config.json) 中的 `appid` 替换为自己的小程序 AppID。

## 验证

```bash
npm run typecheck
npm test
```

领域测试覆盖前置解锁、攻占、首都分数线、幂等结算、失守反叛、补给中断、收复、休整、中断计时，以及行政区几何生成。

## 数据与 CloudBase

没有云环境密钥时，应用默认使用 `Taro.setStorageSync` 本地持久化，因此开箱即可完成全部核心玩法。图片证据在 H5 转为 data URL，在微信小程序复制到应用持久文件目录。

领域层只依赖 [`WorldRepository`](./src/services/world-repository.ts)。`CloudWorldRepository` 已保留接入边界；获得 CloudBase 环境 ID、登录方式和安全规则后，可在该实现中加入：

1. 按用户 UID 读取和保存 `WorldState`；
2. 用云函数执行 `settleSession`，以 `clientMutationId` 建唯一索引；
3. 把图片上传到云存储并将本地路径替换为 `fileID`；
4. 小程序微信登录与 H5 邮箱账号关联。

当前版本不会伪造云端同步：在配置真实 CloudBase 环境前，网页和微信端的数据分别保存在各自设备上。

## 主要目录

- `src/domain`：领域类型、模板、状态机和展示映射
- `src/state`：React 全局状态及持久化编排
- `src/components`：战役创建、领地地图与城池档案
- `src/pages`：司令部、地图、出征结算和战史
- `tests`：纯领域验收测试
