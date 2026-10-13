# 发布文件说明

线上站点和本地阅读器使用 `docs/` 中的完整发布程序；`outputs/澄墨笔记网站/` 是相同的便携交付文件。

目前 `src/App.tsx` 是早期的独立分类笔记原型，与完整阅读器的界面、手机导航和 `chengmo-notes-v1` 数据格式不同。不要将它的 `npm run build` 结果直接覆盖到 `docs/assets/script-2.js`，否则会回退品牌、导航和笔记存储。普通构建默认输出到 `dist/`，可在那里单独预览。

修改发布版本后执行：

```sh
node tools/check-release.mjs
node tools/check-touch-annotations.mjs
git diff --check
```

入口 HTML、增强加载器与 Service Worker 必须缓存完全一致的资源 URL（包括查询参数）。变更主程序后同时更新入口资源参数及 Service Worker 的缓存名称。

2026-10-13 的恢复版本保留正常阅读器的 KaTeX 渲染、手机导航、触摸标注和数据持久化；恢复前会导入意外原型版本中新增的笔记，且保留原始存储。
