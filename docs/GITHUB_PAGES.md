# GitHub Pages 上线与维护说明

这份文档只覆盖 GitHub Pages 网站，不涉及 Tauri 桌面安装包的发布。

## 已实现内容

| 文件 | 用途 |
| --- | --- |
| `site/index.html` | 静态产品主页 |
| `site/assets/styles.css` | 页面样式、响应式布局与亮/暗主题 |
| `site/assets/main.js` | 键盘热图、点击热区、三段式主题、中英切换与动态版本 |
| `site/assets/i18n.js` | 完整的中英文页面文案 |
| `site/assets/version.js` | 从 `package.json` 自动生成的页面版本号 |
| `site/assets/fonts/` | 本地字体，不请求第三方字体服务 |
| `site/assets/icon.svg` | 暖纸色、橙色与荧光绿应用图标源文件 |
| `site/assets/icon.png` | favicon 和页面图标 |
| `site/assets/og-image.svg` | 社交分享图源文件 |
| `site/assets/og-image.png` | 社交分享预览图 |
| `site/favicon.ico` | 浏览器默认 favicon 请求 |
| `.github/workflows/pages.yml` | GitHub Actions 部署入口 |
| `site/tests/landing.test.ts` | 页面结构、交互和部署配置测试 |

目标地址：

```text
https://justcodingnobb.github.io/Tactile/
```

如果之后绑定自定义域名，以 GitHub Pages 设置里显示的地址为准。

## 本地预览

在仓库根目录运行：

```bash
cd site
python3 -m http.server 4173
```

打开：

```text
http://127.0.0.1:4173/
```

不要直接双击 `site/index.html`。本地 HTTP 服务更接近 GitHub Pages 的运行环境，也能正确加载 ES module。

运行页面测试：

```bash
npm test -- site/tests/landing.test.ts
```

页面参考 Tactile 桌面应用的暖纸色、橙色和荧光绿配色。页头主题控件提供
**亮 / 暗 / 跟随系统** 三个选项，首次访问默认选择 **跟随系统**。选择“亮”或“暗”
后会保存你的偏好；只有选择“跟随系统”时，页面才会随操作系统主题实时变化。

页头同时提供 **中文 / EN** 双语切换，默认中文并保存选择。页头版本徽标和下载区
版本号统一读取 `package.json`，不会在 HTML 中重复写死。

## 需要你在 GitHub 上完成的操作

### 1. 确认仓库是否支持 Pages

打开仓库：

```text
https://github.com/justcodingnobb/Tactile/settings/pages
```

如果页面提示当前账户或组织不支持私有仓库 Pages，需要选择其一：

- 将仓库改为公开。
- 使用支持私有仓库 Pages 的 GitHub 付费方案。

公开仓库使用 GitHub Free 即可部署 GitHub Pages。

### 2. 提交并推送本站点改动

本站点工作流只会在 `main` 分支发生变化时自动部署。当前开发分支是
`justcodingnobb/dev-2`，所以需要先把改动合并到 `main`。

提交示例：

```bash
git add site docs/GITHUB_PAGES.md .github/workflows/pages.yml
git commit -m "feat: add GitHub Pages product site"
git push origin justcodingnobb/dev-2
```

然后在 GitHub 创建 Pull Request，目标分支选择 `main`，检查通过后合并。

如果你直接在本地合并：

```bash
git switch main
git pull --ff-only origin main
git merge --no-ff justcodingnobb/dev-2
git push origin main
```

合并后，`pages.yml` 会因为 `site/**` 或工作流文件变化而自动启动。

### 3. 把 Pages 的来源切换为 GitHub Actions

打开：

```text
GitHub 仓库 → Settings → Pages
```

在 **Build and deployment** 区域：

1. 将 **Source** 选择为 **GitHub Actions**。
2. 不要选择 “Deploy from a branch”。
3. 不需要创建 `gh-pages` 分支。

仓库中的 `.github/workflows/pages.yml` 会负责验证、打包和上传 `site/` 目录。

### 4. 第一次部署

工作流合并到 `main` 后通常会自动运行。若没有自动运行，手动触发一次：

1. 打开 **Actions**。
2. 左侧选择 **pages**。
3. 点击右侧 **Run workflow**。
4. Branch 选择 `main`。
5. 点击绿色 **Run workflow**。

也可以使用 GitHub CLI：

```bash
gh workflow run pages.yml --ref main
gh run list --workflow pages.yml
```

### 5. 批准部署环境

如果仓库设置了 Environment protection rules，首次部署可能停在
**Waiting for approval**。

打开：

```text
GitHub 仓库 → Actions → pages → 当前运行 → Review deployments
```

确认 `github-pages` 环境后，选择 **Approve and deploy**。

个人仓库通常不需要这一步。

### 6. 检查部署结果

工作流完成后，打开：

```text
https://justcodingnobb.github.io/Tactile/
```

至少检查以下内容：

- 页面标题、字体、图标和社交分享图能正常加载。
- 按键盘任意键时，Hero 区域键帽会亮起，最后按键和本次按键数会变化。
- 点击热区时，对应格子和总点击数会变化。
- 默认选择“跟随系统”并与操作系统一致；“亮 / 暗 / 跟随系统”三段控件可切换，刷新后选择仍保留。
- “中文 / EN”可切换整页文案、标题、无障碍标签和页面语言，刷新后选择仍保留。
- 页头与下载区显示 `package.json` 中的当前版本号，两处保持一致。
- 手机宽度下导航、键盘、仪表盘和下载区不横向溢出。
- 下载按钮打开 GitHub Releases 最新版本页面。

工作流成功地址也可以从 Actions 的部署任务输出中查看。

## 后续更新

每次修改 `site/` 或 `.github/workflows/pages.yml` 并合并到 `main` 后，Pages 会自动重新部署。

常用修改位置：

| 想改什么 | 修改位置 |
| --- | --- |
| 标题、介绍、功能文案、下载说明 | `site/index.html` |
| 颜色、间距、响应式布局 | `site/assets/styles.css` |
| 键盘/热区交互 | `site/assets/main.js` |
| 社交分享图 | 替换 `site/assets/og-image.png` |
| 中文或英文文案 | `site/assets/i18n.js` |
| 当前版本号 | `package.json` 的 `version`，然后运行 `npm run version:site` |

页面中的下载按钮使用稳定地址：

```text
https://github.com/justcodingnobb/Tactile/releases/latest
```

因此发布新版安装包后，通常不需要修改网站下载链接。

### 版本号同步

`site/assets/version.js` 是生成文件，不应手动修改。页面两处版本号都从这里读取，
而这里又由 `package.json.version` 生成。

正常发版：

```bash
npm run version:set -- 1.0.0-beta.6
```

该命令会更新项目各处的版本，并自动同步 `site/assets/version.js`。如果只手动改了
`package.json.version`，补运行：

```bash
npm run version:site
```

Pages 工作流在部署前也会重新运行同步脚本，并校验生成结果。

## 权限和 Secret

当前 Pages 工作流不需要你添加 Token 或 Secret。它使用 GitHub 自动提供的 OIDC 身份部署，权限声明在工作流中：

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

不要把个人访问令牌写进 `site/` 或仓库文件。

## 常见问题

### Actions 里没有 `pages` 工作流

确认 `.github/workflows/pages.yml` 已经推送到默认分支 `main`。`workflow_dispatch`
只会在工作流存在于默认分支后出现在 Actions 页面。

### 工作流成功，但网址仍然 404

依次检查：

1. **Settings → Pages → Source** 是否为 **GitHub Actions**。
2. 最新的 **pages** 工作流是否成功完成。
3. 部署环境是否还在等待批准。
4. 是否访问了错误的仓库路径。项目页通常区分大小写。
5. 刚部署完成时等待 1–3 分钟并强制刷新。

### 页面打开后没有样式

检查浏览器开发者工具的 Network 面板。站点资源必须使用相对路径：

```html
<link rel="stylesheet" href="./assets/styles.css" />
<script type="module" src="./assets/main.js"></script>
```

不要改成 `/assets/styles.css`，否则在 `/Tactile/` 子路径下会 404。

### 点击键盘没有反应

先确认 `site/assets/main.js` 返回 200，再检查浏览器 Console 是否有 JavaScript 错误。演示只监听 `keydown`，不会读取或发送按键内容。

### 部署权限被拒绝

检查 **Settings → Actions → General → Workflow permissions**。工作流本身声明了
`pages: write` 和 `id-token: write`，但组织策略可能仍禁止 Pages 部署。

### 想回滚页面

最直接的方式是在 `main` 上恢复或撤销出问题的提交，然后再次推送。新的提交会触发一次完整部署。

```bash
git revert <bad-commit>
git push origin main
```

不建议直接手动改 Pages 产物，因为下一次部署会覆盖它。

## 可选：绑定自定义域名

打开 **Settings → Pages → Custom domain**，按 GitHub 提示填写域名并配置 DNS。

绑定成功后，建议同时把以下位置改成正式域名：

- `site/index.html` 的 `<link rel="canonical">`
- `og:url`
- JSON-LD 的 `url`

当前没有配置 `CNAME` 文件，使用默认项目页地址。
