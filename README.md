# 千词斩 · 生字复习

给三年级用的语文生字间隔重复（spaced repetition）复习网页。手机浏览器打开就能练，也可以「添加到主屏幕」。

## 怎么打开

线上地址：<https://dominoeffect.github.io/hanzi-review/>

本地预览：在本仓库根目录用静态服务器打开 `index.html`。站点部署在子路径 `/hanzi-review/` 下；若要按同样路径访问，把本目录放到名为 `hanzi-review` 的文件夹里，再从它的上一级启动服务器。

## 数据

`data/` 里的生字、组词和形近字是**示例整理**，不是课本原文。请以孩子手中的教材为准，需要时直接改 `data/characters.json`。

## 致谢

笔画动画使用 [hanzi-writer](https://github.com/chanind/hanzi-writer)（MIT，见 `vendor/hanzi-writer.LICENSE`）。笔画数据来自文鼎（ARPHIC）公开授权字体，许可全文在 `vendor/hanzi-writer-data.ARPHICPL.txt`。
