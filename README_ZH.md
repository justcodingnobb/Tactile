# 指痕 / Tactile

<p align="center">
  <img src="apps/desktop/src-tauri/icons/icon.png" width="120" alt="指痕应用图标" />
</p>

<p align="center">
  一个本地优先的键盘与鼠标活动桌面仪表盘。
</p>

<p align="center">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri_2-24C8DB?logo=tauri&logoColor=white" />
  <img alt="Rust 1.85+" src="https://img.shields.io/badge/Rust-1.85%2B-000000" />
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB" />
  <img alt="Apache 2.0" src="https://img.shields.io/badge/License-Apache_2.0-blue" />
</p>

<p align="center">
  简体中文 · <a href="README.md">English</a>
</p>

指痕统计你如何使用键盘和鼠标，但不记录你输入了什么。所有聚合数据都
保存在本地 SQLite 数据库中，支持 macOS 与 Windows。应用唯一的网络请求是
可选的 GitHub 更新检查，不发送任何统计数据，并且可以在设置中关闭。

## 功能

- **鼠标活动**：移动距离、按键构成、滚轮方向，以及按主屏归一化的 24 × 16
  点击热区。
- **键盘活动**：按物理键位统计按压次数、高频键排行、键盘热图，以及使用修饰键
  的按键占比。窗口打开时，键盘热图会在按下时实时点亮对应按键，计数与排行同步
  更新，也可以当作键盘检测工具。
- **时间视图**：今天、本周、本月、今年或自定义范围，查看每日趋势、小时分布和
  上一周期对比。
- **默认本地**：没有账号、云同步或使用遥测，不保存输入文字、快捷键序列、应用名、
  窗口标题、屏幕内容或原始指针路径。
- **桌面能力**：暂停与恢复采集、全局快捷键、托盘菜单、登录时启动、明暗主题和
  中英文界面。
- **数据导出**：JSON、包含 6 个 CSV 文件的 ZIP、1080 × 1440 PNG 分享卡，以及
  不包含统计数据和设备标识的诊断 JSON。
- **演示模式**：使用只读样例数据浏览界面，不写入真实数据库。

### 功能状态

| 功能 | 状态 |
| :--- | :--- |
| 鼠标与键盘统计 | ✅ 可用 |
| 点击与键盘热图 | ✅ 可用 |
| 每日趋势与周期对比 | ✅ 可用 |
| 本地 SQLite 持久化 | ✅ 可用 |
| JSON、CSV 与分享卡导出 | ✅ 可用 |
| 中英文界面 | ✅ 可用 |
| 演示模式 | ✅ 可用 |
| 从源码构建 macOS 与 Windows 桌面端 | ✅ 可用 |
| GitHub 发布流水线 | ✅ 已配置 |
| 签名应用内更新 | ✅ 配置发布签名后可用 |

## 快速开始

### 环境要求

- Node.js 20+（CI 使用 Node.js 24）
- Rust 1.85+
- 对应平台的 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)

### 从源码运行

```bash
npm install
npm run tauri:dev
```

仅预览界面时，可以运行浏览器版本：

```bash
npm run dev
```

真实输入采集仅在桌面应用中可用。浏览器预览可以生成分享卡，但不会读取输入，
也不会写入应用数据库。

### 构建

```bash
npm run tauri:build
```

Tauri 配置的目标格式为 macOS DMG 与 Windows NSIS。在 macOS 上，如果当前环境
无法生成 DMG，可运行 `npx tauri build --debug --bundles app` 生成 `.app`。
本地未签名构建需要临时关闭更新产物，否则会因为缺少签名密钥而失败：

```bash
npx tauri build --debug --bundles app \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

设置 `TAURI_SIGNING_PRIVATE_KEY` 后会生成 `.app.tar.gz`、`.app.tar.gz.sig`
与 NSIS 更新产物；没有密钥时请使用上面的临时覆盖配置。

`npm run tauri:build` 会执行正常的打包构建；本地没有签名密钥时，请使用上面的
命令临时关闭更新产物。

CI 会在 macOS 上构建调试版 `.app`，在 Windows 上构建调试版 NSIS 安装包。

## 开发

```bash
npm test
npm run build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo check --workspace --no-default-features
```

GitHub Actions 会在 macOS 和 Windows 上执行这些检查。

### 项目结构

```text
apps/desktop/               Tauri 桌面外壳与 SQLite 存储
crates/tactile-core/        输入标准化、聚合、统计与导出
crates/tactile-platform/    平台输入钩子与权限
src/                        React 仪表盘与多语言
```

## 平台说明

### macOS

读取键盘与鼠标事件需要“输入监控”权限。请在 **系统设置 > 隐私与安全性 >
输入监控** 中授权；如仍未生效，请重启采集。指痕不请求辅助功能、
屏幕录制、全盘访问或定位权限。检测到安全输入时，应用会停止统计按键。

### Windows

采集使用标准输入钩子，普通用户权限下即可运行。管理员权限应用中的事件可能
无法捕获。密码框等安全输入无法被识别，其中的按键可能被计入统计；需要私密
输入时请暂停采集。

### 默认快捷键

| 操作 | macOS | Windows |
| :--- | :--- | :--- |
| 暂停或恢复采集 | `Cmd+Shift+P` | `Ctrl+Shift+P` |
| 显示指痕 | `Cmd+Shift+T` | `Ctrl+Shift+T` |

两个快捷键都可以在设置中关闭。

### 构建与发布限制

本地 macOS 构建仅使用临时/链接签名，因此默认不会嵌入 entitlements。Windows
和 macOS 的正式签名、公证尚未在此配置；未签名的 macOS 构建会触发 Gatekeeper
警告。应用内更新使用独立的 Tauri 更新签名密钥，与平台代码签名无关。

### 发布流程

1. 更新所有版本来源：`npm run version:set -- 0.2.0`。
2. 提交版本变更，等待常规构建检查通过。
3. 创建并推送标签：`git tag v0.2.0 && git push origin v0.2.0`。
4. 等待 `release` 工作流生成 GitHub 草稿发布。
5. 检查发布附件与说明，然后发布。

创建标签前，请配置仓库密钥 `TAURI_SIGNING_PRIVATE_KEY`。如果密钥设置了密码，
再配置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；无密码密钥无需设置该项。工作流通过
`tauri-apps/tauri-action` 生成 macOS arm64/x86_64 与 Windows 产物，并由该
action 根据签名产物生成 `latest.json`。发布任务串行运行，避免各平台的清单
互相覆盖。更新端点指向
`releases/latest/download/latest.json`，因此只有仓库与发布可公开下载时才生效；
GitHub 的 `latest` 不包含草稿或预发布版本。

## 数据与隐私

指痕只在用户应用数据目录下的 `tactile.db` 中保存聚合计数：

- 分钟桶：保留 48 小时。
- 小时聚合：保留 90 天。
- 日聚合与每日按键/点击汇总：保留至手动清除。
- 设置：主题、语言、启动、快捷键、引导状态与更新检查偏好。

数据库没有额外的应用层加密，依赖操作系统账户与磁盘权限。设置中的“清除数据”
当前会删除全部应用统计数据，不支持按日期范围清除。操作系统备份可能保留副本。

完整的数据清单与限制见 [PRIVACY.md](PRIVACY.md)。

## 技术栈

- [Tauri 2](https://tauri.app/)，配合 React 19、TypeScript 与 Vite
- Rust 2024：输入采集、聚合、统计与导出
- SQLite（`rusqlite`）：本地持久化
- `rdev` 与 macOS Core Graphics 事件 Tap：平台输入采集

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 许可。
