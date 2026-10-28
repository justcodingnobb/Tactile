# Tactile GitHub Pages 预览包

这个压缩包包含可直接部署的静态站点、GitHub Pages 工作流和上线操作说明。

`screenshots/` 内附桌面与手机尺寸、中文与英文、亮色与暗色主题的 8 张验收图：

```text
preview-desktop-light-zh.jpg
preview-desktop-dark-zh.jpg
preview-desktop-light-en.jpg
preview-desktop-dark-en.jpg
preview-mobile-light-zh.jpg
preview-mobile-dark-zh.jpg
preview-mobile-light-en.jpg
preview-mobile-dark-en.jpg
```

## 本地查看

解压后进入压缩包根目录，运行：

```bash
cd site
python3 -m http.server 4173
```

浏览器打开：

```text
http://127.0.0.1:4173/
```

不要直接双击 `site/index.html`。通过本地 HTTP 服务打开，资源路径和 ES module
行为才会与 GitHub Pages 一致。

## 本次视觉版本

- 参考 Tactile 桌面应用的暖纸色、橙色热区和荧光绿状态色。
- 页头主题控件使用“亮 / 暗 / 跟随系统”三段式选择。
- 首次访问默认选择“跟随系统”；手动选择后会保存偏好。
- 页头提供“中文 / EN”切换，整页正文、标题、元数据和无障碍标签同步切换。
- 页头与下载区版本号从 `package.json.version` 生成，不在 HTML 中写死。
- 功能卡说明使用正常文档流，不覆盖图表。
- 1440、1024、768、390px 四种宽度已覆盖中英双语和亮暗主题，共 16 组检查。
- 所有组合均无横向溢出、文字越界与可见文字重叠，浏览器控制台无报错。

## GitHub 上线

完整操作步骤见 `docs/GITHUB_PAGES.md`。

目标地址：

```text
https://justcodingnobb.github.io/Tactile/
```
