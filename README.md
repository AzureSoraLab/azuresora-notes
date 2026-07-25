# 澄墨笔记

一个以阅读、整理和回顾为中心的离线优先 Markdown 笔记网站。项目提供可直接部署的静态站点，也保留 React 源码，便于继续开发。

## 在线访问

GitHub Pages 会从 `master` 分支的 `docs/` 目录发布站点。启用 Pages 后，可在仓库的 **Settings -> Pages** 查看实际访问地址。

## 功能

- 笔记分类、新建、编辑、搜索和删除
- Markdown 与 KaTeX 公式渲染、正文目录和阅读进度
- 文本高亮、下划线、评论、标签和标注管理面板
- 自由绘图、笔迹选择、隐藏与恢复
- 最近阅读（最多 5 条）和阅读会话恢复
- 三种阅读纸张主题与可拖动的侧栏展开按钮
- 本地备份导入、导出；数据保存在浏览器 LocalStorage 和 IndexedDB

## 本地运行

### 直接查看发布版本

需要 Python 3。在 Windows 上双击 `Start-Chengmo.bat`，或运行：

```powershell
./start_chengmo.ps1
```

随后访问 `http://127.0.0.1:8080/index.html`。

### 开发源码

需要 Node.js 和 pnpm：

```bash
pnpm install
pnpm dev
```

构建可发布的静态版本：

```bash
pnpm build:portable
```

构建结果位于 `outputs/澄墨笔记网站/`。发布前请同步该目录到 `docs/`，两处应保持一致。

## 项目结构

```text
src/                         React 源码
outputs/澄墨笔记网站/         本地可直接运行的静态站点
docs/                        GitHub Pages 发布目录
tools/                       构建与持久化辅助脚本
start_chengmo.ps1            本地静态服务启动脚本
```

## 数据与隐私

笔记默认仅保存在当前浏览器中，不会上传到服务器。清除浏览器站点数据会删除本地笔记；建议定期使用“导出备份”保存 JSON 文件。

## 技术栈

React、TypeScript、Vite、Marked、KaTeX，以及浏览器 LocalStorage / IndexedDB。

## 许可证

本项目采用 [MIT License](LICENSE)。
