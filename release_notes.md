# LightAlbum v0.4.4

> 大图预览翻页更跟手 —— 相邻照片提前预热

## 下载

| 平台 | 文件 |
|------|------|
| Windows (x64) | `LightAlbum_0.4.4_x64-setup.exe`（推荐）或 `LightAlbum_0.4.4_x64_en-US.msi` |
| macOS (Apple Silicon) | `LightAlbum_0.4.4_aarch64.dmg` |
| macOS (Intel) | `LightAlbum_0.4.4_x64.dmg` |
| Linux (x64) | `LightAlbum_0.4.4_amd64.AppImage` 或 `LightAlbum_0.4.4_amd64.deb` |
| Linux (Fedora/RHEL, x64) | `LightAlbum-0.4.4-1.x86_64.rpm` |

[前往 Releases 页面](https://github.com/Aswellle/LightAlbum/releases/latest)

---

## 实现

- **相邻照片提前预热** —— 打开大图预览后，前后各一张的缩略图与原图路径会立即开始加载；用方向键或滚轮连按时，下一张已是完整画面，不再出现「先放大一张缩略图、再等原图解码」的空窗。

## 添加

- **共用测试基础设施** —— 为预览层与启动阶段统一提供假 Tauri IPC：列表类接口一律返回数组，避免 stub 返回 null 把应用打进错误边界（这曾在 0.4.2 阻断过一次发行）。
- **预览相邻预取回归测试** —— 打开任一张后必须主动请求前后各一张的元数据；未预取时只会请求当前张，测试覆盖这条差异。

## 修复

- **预览模块冗余代码清理** —— 移除从未被读取的飞入矩形、原图加载态、胶片条开关等死接口（含一处未被主流程引用的备用实现），降低后续动画类改动的维护成本。
