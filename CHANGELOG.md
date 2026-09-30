# Changelog

All notable changes to LightAlbum are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### 发行矩阵移除 macOS Intel

#### Changed

- **不再为 macOS Intel（`x86_64-apple-darwin`）出安装包** — 保留 Windows x64 / macOS Apple Silicon / Linux x64。Intel macOS 已不在新系统更新的支持范围内，且它是矩阵里最慢的一个：本轮 `Build macOS Intel` 耗时 23m53s，`Build macOS ARM64` 为 11m23s。`.github/workflows/release.yml`、`docs/RELEASE.md`
- **资产校验改为逐平台校验存在性** — 原先用「资产总数 ≥ 4」判断「四个平台都报到了」，但单个平台可能有多个产物，该阈值既可能放过「其实只有一个平台成功」，也会在平台增删时失效。现在要求 Windows / macOS Apple Silicon / Linux 各自的产物名都出现。`.github/workflows/release.yml`
- **`sidecar/scripts/bundle.js` 保留 `mac_x64` 能力** — 只是发行矩阵不再调用它，本地手动构建 Intel 版仍可用。
- **三平台成为受校验的固定约定** — `scripts/release-platforms.mjs` + `pnpm release:preflight` 校验发行矩阵的平台集合：缺少任一保留平台、或重新引入 macOS Intel，预检直接失败；`scripts/release-platforms.test.mjs` 覆盖「齐全 / 缺平台 / 恢复 Intel」三种情形，并包含一条针对真实 `release.yml` 的契约断言。

## [0.5.1] — 2026-09-30

> 注：**0.5.0 未产出任何构建产物** —— 其发布流水线在 Full CI 关口失败（回归测试假失败），未创建 draft；本版本内容与 0.5.0 相同，仅修正该测试。

### 预览几何回归测试修正

#### Fixed

- **E2E「信息面板不改变照片几何」在 CI 上假失败** — 断言读的是 `boundingBox()`（含祖先 transform），而预览图在飞入动画期间正处于缩放中：实测同一元素 `getBoundingClientRect().width` 会从 700.6 → 1176.4 → 1199.99 才收敛到 1200，而 `offsetWidth` 全程恒为 1200。打开后等 250ms 在本地机器上已经落定，在更慢的 CI runner 上仍是动画尾帧，于是取到 1198.7 而失败（本地通过、CI 必现）。改为读布局几何（`offsetWidth/offsetHeight`）并给 2px 取整容差；并用「把面板改回占用 flex 行宽」的注入样式验证过：该断言仍能抓住真实回归（实测 delta 240 ≫ 2）。`tests/e2e/preview-animation.spec.ts`

## [0.5.0] — 2026-09-30

### 设置项生效性 + 发版流程自动化

#### Added

- **`scripts/release-notes.mjs`** — 发行说明（GitHub Release 正文的唯一来源）的版本号同步与校验：`version:set` / `version:bump` 会一并改写标题与 6 个下载文件名（只匹配这两类形状，正文里的历史版本引用不动），`version:check` 在二者不一致时直接失败。`scripts/release-notes.test.mjs` 覆盖替换、幂等、历史引用不改写与不一致报错（6 条）。
- **`tests/e2e/settings-behavior.spec.ts`** — 断言两个预览开关**真的改变行为**，而不是只断言设置页上有个开关。
- **E2E 共用 stub 支持覆盖 `settings_get`** — `installTauriStub(page, { settings: { … } })`。

#### Fixed

- **两个「死」设置项** — `previewOnDoubleClick` 与 `autoHidePreviewUI` 此前只存在于设置页与类型定义，网格与预览从未读取（点它没有任何效果）。现在前者决定单击 / 双击进入预览（固定网格与两种瀑布流都遵循），后者决定预览工具栏与胶片条是否在闲置 2 秒后自动隐藏；两者启动时从 AppSettings 初始化，设置页改动后即时生效。`src/stores/uiStore.ts`、`src/hooks/useTheme.ts`、`src/components/grid/GridItem.tsx`、`src/components/grid/WaterfallGrid.tsx`、`src/features/library/grid/WaterfallGridV2.tsx`、`src/components/preview/PreviewToolbar.tsx`、`src/components/settings/sections/GeneralSection.tsx`
- **双击打开预览会「闪一下就被关掉」** — 双击的第二下落在遮罩背板上会触发「点背板关闭」；现在忽略打开后 300ms 内的背板点击。`src/components/preview/PhotoPreview.tsx`、`src/stores/previewStore.ts`

### 预览共享元素飞入 / 飞出（ADR-007）

#### Added

- **预览飞入 / 飞出** — 从网格点开大图时，预览图从被点击的格子位置等比长大到适应窗口；关闭时反向飞回（仅限「从格子点开」的那张，左右切换过之后退化为淡出）。位移与缩放全部走 transform，符合「动画只用 transform/opacity」约定；源矩形是打开瞬间的快照，虚拟化卸载源格子也不会让飞行失效。`src/components/preview/PreviewImage.tsx`、`src/stores/previewStore.ts`
- **`docs/decisions/ADR-007-preview-shared-element-transition.md`** — 飞入/飞出契约：入口快照、方向判定（`direction === 0` 才算「来自格子」）、虚拟化兜底、减弱动效、帧级不变量，以及「与挂载时机无关」的关键帧实现约束。
- **`src/features/library/README.md`** — 标明 V2 视图层（13 文件 / 1923 行）状态：计划中、未接线、外部零引用，删除前需确认。
- **E2E 探针字段 `previewImgW`** — 逐帧记录预览图渲染宽度，用于断言飞入确实发生（起点明显小于终态，而不是直接出现在最终位置）。

#### Changed

- **预览遮罩合成：先测量后决定（不改动）** — 用一次性 rAF 帧间隔探针测得：空闲 60fps 干净，打开动画 p95 73.3ms（9 帧 >33ms），关闭 p95 70.9ms；**关掉 `backdrop-filter` 后 p95 降至 35.9ms**，但仍剩 5 帧 >33ms。结论与候选修法记入 `docs/decisions/ADR-008-preview-backdrop-compositing.md`：不以 headless 软件合成的数字改架构，待真机 GPU 复测后再决定是否拆分「静态模糊层 + 遮罩层」。
- **`previewStore.open()` 恢复 `rect` 参数** — 与 v0.4.4 删掉的死管道不是一回事：这次它被真正消费（飞入起点），入参来自格子 `getBoundingClientRect()` 的快照。

### 注释与文档整理

#### Changed

- **移除源码注释与 E2E 标题里的内部批次编号** — 这些标记对仓库读者没有意义，注释正文本身已说明代码在做什么；E2E 标题改为按行为命名（`内容区无闪烁` / `大图预览无闪烁` / `启动阶段`），CHANGELOG 段标题改为按内容命名。`src/**`、`tests/e2e/*.spec.ts`、`docs/decisions/ADR-007-*.md`

## [0.4.4] — 2026-09-29

### 预览相邻预取 / 测试基建 / 死代码清理

#### Added

- **预览相邻预取** — 打开大图预览后立即预取前后各一张的 `m` 缩略图与 `['photo', id]` 元数据：方向键连按时下一张已是完整画面，而不是「先放大一张缩略图再等原图」。`src/components/preview/PreviewImage.tsx`
- **`tests/e2e/support/tauriStub.ts`** — 共用的假 Tauri IPC 与逐帧探针。契约兜底：所有 `*_list` / `*_all` / `*_batch` 命令一律返回数组（组件里的 `= []` 默认值只对 `undefined` 生效，stub 返回 `null` 会崩进错误边界——曾让断言时好时坏并阻断过一次发行）；探针同时用 rAF 与 50ms 心跳采样，并统一记录「是否已崩进错误边界」。

#### Changed

- **三个 E2E spec 迁移到共用 stub** — `flicker` / `preview-animation` / `startup` 不再各写一份假 IPC，并新增「不得出现『界面渲染出错』」断言。`tests/e2e/*.spec.ts`
- **启动测试窗口放大** — `startup.spec.ts` 的列表查询延迟提到 1500ms，消除启动窗口的时序竞争。

#### Removed

- **previewStore 死代码** — `sourceRect` / `updateSourceRect` / `selectSourceRect`、`isLoadingOriginal` / `setLoadingOriginal`、`toggleFilmstrip`：仅存在于定义处、无任何读取方；`open()` 随之去掉 `rect` 参数，`GridItem` / `WaterfallGrid` / `WaterfallGridV2` / `useKeyboard` 里的取矩形与传参一并删除，`SourceRect` 类型（`types/layout.ts`）随之移除。
- **未使用的预览 CSS** — `.la-preview-backdrop`、`.la-preview-container`（无任何引用）。`src/styles/animations.css`

## [0.4.3] — 2026-09-29

> 注：**0.4.2 未发行** —— 该次运行的 Full CI 被启动回归 spec 的崩溃挡住，未走到构建阶段；标签留在原地，同样内容以 0.4.3 发行（本节的用户可见内容即 0.4.2 那一批）。

### 大图预览观感 + 缩略图缓存上限

#### Added

- **`src/services/thumbnail/ThumbnailScheduler.test.ts`** — 覆盖缓存命中、LRU 淘汰、`invalidate` 代际失效、`preload` 跳过、容量受控。
- **`tests/e2e/preview-animation.spec.ts`** — 预览逐帧回归：打开与方向键切换全程有图像（不闪骨架占位）；信息面板打开不改变照片几何（覆盖层判别式）；删除确认弹窗位于预览之上且可点击。
- **`MotionConfig reducedMotion="user"`** — 系统「减少动态效果」现在也能约束 framer-motion（此前全局 CSS 的 `prefers-reduced-motion` 只能管 CSS 动画，管不到 JS 动画）。
- **`tests/e2e/startup.spec.ts`** — 启动回归：列表数据到达前不闪「暂无相册 / 暂无标签」，到达后提示照常出现；首屏数据仍在途中时外壳已可交互（点击收藏即发出收藏查询）。帧采样同时使用 `requestAnimationFrame` 与 50ms 定时心跳：页面静止时 CI 合成器可能不再产生 rAF 帧，只靠 rAF 会漏采「数据到达之后」的窗口，让「不闪空态」的断言假通过；并加守卫断言要求采样确实覆盖该窗口。

#### Changed

- **逐张切换不再硬切** — 预览改为「缩略图底图 + 原图」双层交叉淡变：切换照片时网格里已缓存的 `s` 缩略图立即顶上，原图 `onLoad` 后淡入。原实现在同一个 `<img>` 上换 `src`，并用未纳入过渡的 `filter: brightness(0.92)` 提示占位，切换当帧跳变。`src/components/preview/PreviewImage.tsx`
- **占位几何与最终图像一致** — 骨架占位改用 `fitDim`，不再固定 3:2（换成 `<img>` 时会跳尺寸）。
- **切换照片的手势重置改到绘制前** — `useEffect` → `useLayoutEffect`：新照片不会再先按上一张的缩放/偏移绘制一帧。`src/hooks/usePreviewGesture.ts`
- **平移边界钳制生效** — 原图尺寸由图片层上抛给手势钩子（原先恒传 `null`，`clampOffset` 直接早退，照片可被拖出屏幕）。`src/components/preview/PreviewImage.tsx`
- **信息面板改为覆盖层** — 原为 flex 兄弟节点（`width:320px` + `flexShrink:0`），面板出现的第一帧就把照片挤窄（重排），250ms 后面板才滑到位；现在绝对定位覆盖，照片几何不变，滑动仍是纯 transform。`src/components/preview/ExifPanel.tsx`
- **切换动画更克制** — 位移 25% → 15%；去掉两张绝对定位图层之间的 `mode="popLayout"`（无效测量）。`src/components/preview/PreviewImage.tsx`
- **导航箭头让出面板宽度** — 信息面板打开时箭头左移，不再叠在面板边缘。`src/components/preview/PreviewImage.tsx`
- **快速「关闭 → 重开」不再有空白窗口** — 覆盖层 `AnimatePresence` 去掉 `mode="wait"`（wait 会等 0.22s 退出动画走完才挂载新的覆盖层）。`src/app/App.tsx`
- **侧边栏加载态不再误显示为空** — 相册与标签区块在查询 pending 期间不渲染「暂无相册 / 暂无标签」，避免首屏闪一下空态（实测未门控时，数据到达前会画出 ~24 帧空态，约 400ms）；数据到达后若确实为空，引导文案照常出现。`src/components/layout/Sidebar.tsx`、`src/components/layout/TagFilterPanel.tsx`

#### Fixed

- **预览内的确认弹窗点不到** — `--la-z-modal` 400 < `--la-z-preview` 500，删除确认被压在预览覆盖层之下（Playwright 实测：`<div id="root">` 拦截了点击）；令牌提升到 550，仍低于 toast(600)/tooltip(700)/标题栏(800)。`src/styles/tokens.css`
- **`ThumbnailScheduler` 的「LRU」从不淘汰** — 只有 Map、无容量判断，长时间浏览内存只增不减；改为真正按访问序淘汰（默认 20000 条 URL 记忆）。淘汰只影响「重复解析路径」的优化，不影响已显示照片（URL 由 React Query 持有，gcTime 30 分钟）。`src/services/thumbnail/ThumbnailScheduler.ts`

## [0.4.1] — 2026-09-28

### 内容区闪烁消除（切换视图 / 筛选 / 启动过渡）

#### Added

- **`src/components/grid/GridSkeleton.tsx`** — 固定网格与瀑布流共用骨架屏，几何参数与真实网格一致（骨架 → 照片不发生跳动）；瀑布流此前加载期间完全没有占位。
- **`src/services/themePreference.ts`** — 主题的「首帧前」持久化读取（`localStorage('la-theme')`）。
- **`docs/decisions/ADR-006-content-transition-flicker.md`** — 内容替换时机、三态渲染、跨视图不重挂载的决策记录。
- **`tests/e2e/flicker.spec.ts`** — 逐帧回归测试：以 `requestAnimationFrame` 采样内容区 `data-grid-state`，断言启动、切换未缓存/已缓存选项卡、标签筛选四条路径均不出现空态帧、空白内容帧；已缓存视图切换必须当帧完成。

#### Changed

- **内容替换时机** — `photoStore` 同步从 `useEffect`（绘制之后）改为 `useLayoutEffect`（绘制之前），并按视图键原子替换：缓存命中当帧完成；缓存未命中先清空并由骨架屏承接。`src/hooks/usePhotoData.ts`
- **三态渲染** — `VirtualGrid` / `WaterfallGrid` 内容区改为互斥三态（内容 / 骨架屏 / 空态），空态只在「已同步 + 无照片 + 不在加载中」时出现；新增 `data-grid-state` 观测点。`src/components/grid/VirtualGrid.tsx`、`WaterfallGrid.tsx`
- **虚拟化切片时机** — 可见范围改为渲染期从视口状态推导（原实现由 effect 回填，数据到达当帧先渲染空数组）；视口测量改为 `useLayoutEffect` + `ResizeObserver`，新增 `resetKey`：切换视图滚动回顶部。`src/hooks/useVirtualGrid.ts`、`useWaterfallGrid.ts`
- **视图路由** — `MainContent` 移除 `AnimatePresence mode="wait"` + `key` 重挂载：网格实例跨视图保持挂载，切换选项卡当帧完成，不再有 120ms 淡出/淡入造成的空白帧。`src/components/layout/AppShell.tsx`
- **容器宽度测量** — 改到 `useLayoutEffect`，首帧即有 `gridConfig`（原实现首帧为 `null`，两个网格都返回 `null` → 空白内容区）。`src/components/layout/AppShell.tsx`
- **缩略图淡入** — 挂载时缩略图已缓存则不做淡入（`initial={false}`），消除滚动回收/重挂载时的整屏重复淡入。`src/components/grid/GridItem.tsx`、`WaterfallGrid.tsx`
- **失效重取语义** — 网格不再随视图切换重挂载，事件路由因此不能再依赖 `refetchOnMount`：`scan:completed` / `photo:created` / `library:changed(added)` 改为 `refetchType: 'active'`；重取中间态保留现有画面，取数结束后整体替换（避免已加载内容先缩短再长回）。`src/data/events/eventRouter.ts`、`src/hooks/usePhotoData.ts`
- **标签视图写入方** — 标签视图下禁用基础查询（`enabled:false`），标签结果不再被「全部照片」覆盖。`src/hooks/usePhotoQuery.ts`、`src/hooks/useTagPhotoQuery.ts`、`src/components/grid/PhotoGrid.tsx`
- **启动主题** — 上次生效主题写入 `localStorage`，`index.html` 首帧前优先采用，`uiStore` 初始值同源，消除「显式主题与系统主题不同」时的启动跳变。`index.html`、`src/stores/uiStore.ts`

#### Fixed

- **切换选项卡闪空白网格** — 可见行范围不再由 post-paint effect 回填，数据到达当帧即渲染正确切片。
- **闪「没有照片」空态** — 空态不再在加载中/内容未同步时出现。
- **启动空白内容区** — 首帧即有 `gridConfig`，且首帧即为骨架屏而非空白。
- **筛选闪烁** — 标签视图与基础查询不再竞争同一个 store（一个视图一个写入方）。
- **已生效主题在启动时跳变** — 浅色用户不再先闪一帧深色。


### 发布流程修复（v0.4.0 发布期间发现）

#### Fixed

- **发布作业缺 checkout** — `publish` 作业没有 `actions/checkout`，`gh release edit` 无法解析仓库而失败（`failed to run git: fatal: not a git repository`）；已补 checkout（`fetch-depth: 0` + `fetch-tags`）并注明不可删除。`.github/workflows/release.yml`
- **发布环境缺少 tag 部署规则** — `release` environment 的 *Deployment branches and tags* 未允许 tag，publish 作业被环境保护规则拒绝；已把该要求写入一次性设置清单与发布指南。`AGENTS.md`、`docs/RELEASE.md`
- **产物文件名与实际不符** — 下载表按 Tauri 实际命名修正（Linux 为大写 `LightAlbum_` 前缀，另含 `.rpm` 与两个 `.app.tar.gz` 更新包）。`release_notes.md`、`docs/RELEASE.md`

## [0.4.0] — 2026-09-27

### 全应用可见度改造（对比度 / 字号 / 字重 / 图标）

#### Added

- **`docs/decisions/ADR-005-ui-visibility-baseline.md`** — 可见度基线决策记录：对比度下限、字号下限、字重角色、填充色令牌、禁用态与悬浮策略。
- **令牌** — `--la-text-placeholder`、`--la-text-on-warning`、`--la-accent-text`、`--la-danger-text`、`--la-accent-fill` / `-fill-hover` / `-fill-pressed`、`--la-danger-fill` / `-fill-hover` / `-fill-pressed`、`--la-warning` / `--la-warning-subtle`、`--la-fill-disabled`、`--la-shadow-xl`。
- **`src/components/grid/GridEmptyState.tsx`** — 共用空态组件（固定网格与瀑布流共用；瀑布流此前完全没有空态）。
- **图标** — `book-plus`（新建相册）、`lock-plus`（新建私密相册）、`folder-plus`（添加文件夹），统一为「父级图形 + 加号」家族。
- **`prefers-contrast: more`** — 系统高对比度偏好下自动提升次要/弱化文字与描边。

#### Changed

- **文字令牌对比度**（相对各自实际所在表面）：深色 secondary `#98989D → #A9A9B0`（7.3:1）、tertiary `#636366 → #96969E`（5.8:1）、disabled `#48484A → #83838B`；浅色 secondary `#86868B → #4A4A52`（8.8:1）、tertiary `#AEAEB2 → #68686D`（5.5:1）、disabled `#C7C7CC → #7C7C84`。
- **字号阶梯** — `--la-text-xs` 11 → 12px，`--la-text-sm` 13 → 14px；组件内硬编码的 9/10/11/12/13px 全部改为令牌。
- **字重角色** — 交互标签 500、标题与选中态 600、分组标题（大写）700。
- **填充色** — `--la-accent-fill`（深 `#0A66D0` / 浅 `#0071EB`）与 `--la-danger-fill`，保证白字 ≥4.5:1；`--la-accent` 保留为图形色。
- **图标线宽随尺寸自适应** — `Icon` 在 16px 以下按比例加粗，消除 12–14px 图标的亚像素发丝线；侧边栏动作按钮 18×18/12px → 24×24/15px。
- **悬浮策略** — 取消文字「由浅入深」的淡化过渡，悬浮只改背景/描边（或向更强的文字档位过渡）；禁用态不再叠加 `opacity`。
- **侧边栏** — 未选中导航项使用 medium 字重 + 提升后的 secondary 色；分组标题 tertiary → secondary + 700；相册/文件夹行与计数改令牌；标签区块标题、计数、空态文案与折叠态图标统一。
- **状态栏** — 计数、扫描阶段、百分比、布局/密度标签全部改令牌；密度图标保留点阵图案，点径与对比度提升、热区扩大到 ≥22×22。
- **搜索框** — 静止态改用可承载 4.5:1 的 `--la-bg-raised` + `--la-border-strong`，占位符改用专用令牌（并新增全局 `::placeholder` 规则），清除按钮与历史/建议下拉改令牌。
- **空态** — 插画描边 1.5 → 1.75 并提升为 secondary；主文案 base/semibold/primary，辅助文案 sm/secondary。
- **表单控件** — 全局 `input/textarea/select { font: inherit }`，消除 WebView2 默认的 Arial 13.33px；新增 `::selection` 主题化。
- 标签系统（TagBadge / TagEditor / 侧边栏标签面板 / 照片标签角标）、批量操作条、右键菜单、Toast、确认弹窗、标题栏、设置页与大图预览面板同步按基线改造。

#### Fixed

- **瀑布流无空态** — 照片为空时瀑布流视图不再是一片空白。
- **侧边栏重命名监听泄漏** — `useState` 初始化器被当作 effect 使用，导致 `album:start-rename` 监听器永不注销；改为 `useEffect` 并正确清理。
- **未定义令牌** — `--la-shadow-xl`、`--la-warning`、`--color-muted`、`--color-accent` 的引用（前三者导致阴影/警告色静默失效）。
- **大图预览浅色主题** — 预览界面在浅色主题下继承浅色文字令牌导致暗底暗字（2.39:1）；改为在预览根节点声明固定深色作用域。

## [0.3.0] — 2026-09-12

### V2 Data Flow Architecture — 全面重构

#### Added

22 个新文件，覆盖 `src/domain/`、`src/data/`、`src/stores/`、`src/features/library/`、`src/services/thumbnail/` 五大模块。

- **规范化 Entity Store** (`src/stores/photoEntityStore.ts`) — `byId: Record<string, PhotoEntity>` 单一实体源，O(1) 查找/patch/upsertMany/removeMany。
- **轻量 Collection Store** (`src/stores/collectionStore.ts`) — `orderedIds: string[]` + `sections: SectionMeta[]`（仅保存 `start/count` 边界，不复制 Photo 对象），增量追加 O(pageSize + newSections)。
- **Domain 类型** (`src/domain/photo/photoTypes.ts`) — `PhotoEntity`、`PhotoPageResult`、`SectionDelta`、`SectionMeta`、`getDisplayAspectRatio`（EXIF 方向感知）。
- **Collection Repository** (`src/data/photos/photoRepository.ts`) — 纯 IPC 仓库层，游标分页 100 条/批。
- **Query Key 工厂** (`src/data/photos/photoQueries.ts`) — 稳定 `buildCollectionKey(filter)` 序列化。
- **usePhotoCollection Hook** (`src/features/library/hooks/usePhotoCollection.ts`) — 替代原 `usePhotoData`，管理 `useInfiniteQuery` + 归一化写入 EntityStore + CollectionStore。
- **usePhotoEntity Hook** (`src/features/library/hooks/usePhotoEntity.ts`) — O(1) 单实体订阅。
- **Fixed Grid V2** (`src/features/library/layout/fixedGridLayout.ts`) — Section 前缀偏移 + 二分查找，O(log S + V) 可见行计算。
- **VirtualPhotoGrid** (`src/features/library/grid/VirtualPhotoGrid.tsx`) — 虚拟化固定网格 + GridSkeleton/EmptyState。
- **useVirtualCollection Hook** (`src/features/library/hooks/useVirtualCollection.ts`) — 固定网格集合管理。
- **Waterfall V2** (`src/features/library/layout/waterfallLayout.ts`) — Float32Array/Float64Array 布局数据 + 列内二分视口查询。
- **Spatial Index** (`src/features/library/layout/spatialIndex.ts`) — 列内二分查找可见项，O(C log(N/C) + V)。
- **Layout Worker** (`src/features/library/layout/layout.worker.ts`) — Web Worker 离主线程布局计算。
- **WaterfallGridV2** (`src/features/library/grid/WaterfallGridV2.tsx`) — 虚拟化瀑布流 + WaterfallSkeleton/WaterfallEmptyState。
- **useWaterfallLayout Hook** (`src/features/library/hooks/useWaterfallLayout.ts`) — 瀑布流布局 + 视口查询。
- **Thumbnail Scheduler V2** (`src/services/thumbnail/ThumbnailScheduler.ts`) — 任务状态机 (queued/running/fulfilled/failed/cancelled) + 优先级提升 + 代际失效 + O(1) 双端队列。
- **Event Bus V2** (`src/data/events/`) — EventEnvelope (version/seq/revision/mutationId) + EventRouter domain handlers + LibrarySyncState revision gap 检测。
- **Preview Pipeline V2** (`src/features/library/preview/`) — M → L/XL → original 渐进加载 + PreviewController 状态管理。
- **Motion System** (`src/styles/tokens.css`) — `--la-motion-fast/normal/slow` + `--la-ease-standard/emphasized` + `prefers-reduced-motion` 媒体查询。

#### Changed

- **photoStore 重构为兼容 Facade** — `src/stores/photoStore.ts` 保持原 API 不变，内部委托给 EntityStore + CollectionStore，订阅机制仅同步活跃集合实体变更（避免无关变更触发全量派生）。
- **瀑布流 photoId 映射修复** — `useWaterfallLayout` 中使用 `orderedIds[index]` 替代错误的 `Object.keys(byId)[index]`，确保瀑布流单元格渲染正确照片。
- **photo:updated 事件处理器修复** — 使用 `invalidateQueries` 触发后端重新获取，替代原先的空 `patch({})` 无操作。
- **ThumbnailScheduler.promoteExisting 修复** — 在修改 `task.priority` 之前捕获 `oldBucket`，确保优先级提升（如 low → high）正确执行。
- **collectionStore 缓存隔离** — 每个集合使用独立的 `Map<key, cache>` 查找表，消除跨集合数据泄漏。
- **WaterfallGridV2 作用域修复** — 使用集合作用域 `allIds` 替代全局实体存储，确保键盘导航和选择仅在当前集合内生效。
- **EventRouter 单例修复** — `latestRevision` 移入类实例，避免 HMR/测试时状态不一致。
- **layout.worker 方向感知** — 使用 `getDisplayAspectRatio()` 处理 EXIF 旋转方向，与主线程计算一致。
- **useWaterfallLayout 重算触发** — `recompute` 依赖数组添加 `orderedIds`，确保布局变化后可见项正确更新。
- **usePhotoCollection 多页缓存** — 正确处理多页缓存数据，避免 `replaceFirstPage` 丢弃已缓存页。
- **selectPhotoById 边界检查** — 添加索引边界验证 + ID 匹配验证，防止索引漂移返回错误照片。

#### Fixed

- **瀑布流渲染错误** — `Object.keys(byId)[index]` 返回插入顺序而非有序索引，导致瀑布流单元格渲染错误照片或空白。
- **实时更新丢失** — `photo:updated` 事件处理器 `patch({})` 为空操作，后端推送的收藏/元数据编辑永远不反映到 UI。
- **缩略图优先级失效** — `promoteExisting()` 在修改 priority 后计算 bucket，导致 `oldBucket === newBucket` 永远为 true，优先级提升从未执行。
- **跨集合数据泄漏** — 模块级 `entityLookupCache` 被所有集合共享，切换视图时实体互相覆盖。
- **Worker 方向忽略** — layout.worker 使用原始 width/height 计算宽高比，旋转照片布局高度错误。
- **forceUpdate 不触发重算** — `recompute` 的 `useCallback` 依赖数组为空，布局变化后 visibleItems 不更新。
- **多页缓存竞争** — `prevPageCountRef.current === 0` 时 `replaceFirstPage` 仅同步首页，丢弃已缓存的后续页。

#### Documentation

- **README 架构图** — 新增完整 V2 数据流 ASCII 架构图（中英双语）。
- **README 徽章修复** — `LightAblum` → `LightAlbum`，新增 V2 Architecture + Tests passing 徽章。
- **README 性能章节** — 扩展为完整 V2 性能架构（8 项子特性）。
- **Commit Policy (AGENTS.md)** — 写入禁止 AI 署名的铁律。
- **Code Quality Review Report** — `CODE_QUALITY_REVIEW.md` 记录全部 13 项发现与修复。

#### Commit Policy

- **禁止 AI 署名** — 所有提交去除 `Co-Authored-By` 行，AGENTS.md 写入硬规则，确保提交作者仅为人类开发者。

 ## [0.2.0] — 2026-09-11
## [0.2.0] — 2026-09-11

### Release System — 不可变发行体系正式上线

### V2 Refactor Phase 1 — Entity Normalization
### V2 Refactor Phase 2–8 — Data Flow Architecture

#### Added

- **V2 数据流架构** — 完整的 8 阶段重构落地，新架构通过兼容 Facade 与旧组件并行运行。
- **Collection Repository** (`src/data/photos/`) — 纯 IPC 仓库层 + 统一 Query Key 工厂 + 稳定 `buildCollectionFilter` 序列化。
- **Fixed Grid V2** (`src/features/library/layout/fixedGridLayout.ts`) — Section 前缀偏移 + 二分查找，O(log S + V) 可见行计算，不再创建全量 row 对象。
- **Waterfall V2** (`src/features/library/layout/waterfallLayout.ts`) — Float32Array/Float64Array 布局数据 + 列内二分视口查询 + Web Worker 支持。
- **Thumbnail Scheduler V2** (`src/services/thumbnail/ThumbnailScheduler.ts`) — 任务状态机 (queued/running/fulfilled/failed/cancelled) + 优先级提升 + 代际失效 + O(1) 双端队列。
- **Event Bus V2** (`src/data/events/`) — EventEnvelope (version/seq/revision/mutationId) + EventRouter domain handlers + LibrarySyncState revision gap 检测，替代 `resetQueries(['photos'])` 全量刷新。
- **Preview Pipeline V2** (`src/features/library/preview/`) — M → L/XL → original 渐进加载 + PreviewController 状态管理。
- **Motion System** (`src/styles/tokens.css`) — `--la-motion-fast/normal/slow` + `--la-ease-standard/emphasized` + reduced motion 媒体查询。

#### Changed

- **规范化 Entity Store** — 新增 `src/stores/photoEntityStore.ts`，以 `byId: Record<string, PhotoEntity>` 替代原 `photos[] + _photoIndex`，实现 O(1) 单实体查找与 patch。同一实体全局仅存一份。
- **轻量 Collection Store** — 新增 `src/stores/collectionStore.ts`，以 `orderedIds: string[]` + `sections: SectionMeta[]`（仅保存 `start/count` 边界，不复制 Photo 对象）替代原 `groups[].photos[]`。增量追加从 O(N_total) 降至 O(pageSize + newSections)。
- **Domain 类型下沉** — 新增 `src/domain/photo/photoTypes.ts`，定义 `PhotoEntity`、`PhotoPageResult`（轻量分页契约）、`SectionDelta`、`SectionMeta` 等 V2 基石类型。
- **photoStore 重构为兼容 Facade** — `src/stores/photoStore.ts` 保持原 API 不变，内部委托给新的 EntityStore + CollectionStore，并通过订阅机制自动同步。所有旧组件（PhotoGrid / WaterfallGrid / PreviewToolbar 等）无需修改即可运行在新架构上。

#### Added

- **统一版本管理器 `scripts/version.mjs`** — 将 `package.json` / `tauri.conf.json` / `Cargo.toml` / `Cargo.lock` 四份版本号视为一个同步组；人只改 `package.json`，脚本负责同步其余三文件。支持 `check`（校验四文件版本一致）、`set X.Y.Z`（统一设定）、`bump major|minor|patch`（自动递增）三个命令。
- **安全本地发行入口 `scripts/release.mjs`** — 提供 `preflight` 与 `tag` 两个命令。只允许"创建新 Tag"，绝不提供删除 / force / 覆盖功能。preflight 校验：Tag 格式、package.json 版本匹配、当前分支为 main、工作区干净、origin/main 与本地一致、Tag 在本地和远程均不存在。通过后才创建 annotated tag 并 push。
- **全新 CI workflow (`.github/workflows/ci.yml`)** — 增加 `workflow_call` 触发器使 Release workflow 能真正调用 CI；E2E 删除 `--update-snapshots`（禁止 CI 在测试过程中修改快照基线）；全部 step 加 name 提升日志可读性；Runner 升级到 ubuntu-24.04 / windows-2022（ubuntu-22.04 已于 2026-09-17 起弃用）；Action 版本升级到 v7。
- **全新 Release workflow (`.github/workflows/release.yml`)** — 固定管线：`preflight`（Tag 合法 / 版本全一致 / 指向当前 commit / Release 不可重复）→ `ci`（workflow_call 全量检查）→ `prepare-release`（创建唯一 Draft Release → 输出 `release_id`）→ `build`（Windows / macOS ARM64 / macOS Intel / Linux 四平台 matrix，全部上传到同一个 `release_id`）→ `verify`（校验 Draft 状态 + 4 平台资产就位）→ `publish`（需 release Environment 人工批准后执行 `gh release edit --draft=false`，进入 immutable 状态）。
- **Release Safety Rules (AGENTS.md)** — 12 条发行铁律（版本号↔commit↔Release 一对一、Published 永远不回写、AI Agent 禁止删除/重建历史 Release 等），直接写入 AGENTS.md 让 AI 编程代理从源头不再执行错误操作。

#### Security

- **修复 crossbeam-epoch 高危漏洞** — `crossbeam-epoch 0.9.18 → 0.9.21`，关闭 [RUSTSEC-2026-0204](https://rustsec.org/advisories/RUSTSEC-2026-0204)（Atomic/Shared 的 fmt::Pointer 实现对无效指针解引用）。
- **修复 quick-xml 高危漏洞** — `quick-xml 0.38.4 → 0.41.0`，关闭 [RUSTSEC-2026-0194](https://rustsec.org/advisories/RUSTSEC-2026-0194)（重复属性名检查的二次时间复杂度 DoS）+ [RUSTSEC-2026-0195](https://rustsec.org/advisories/RUSTSEC-2026-0195)（NsReader 无界命名空间声明分配导致内存耗尽 DoS），Severity 7.5 (high)。同步升级传递依赖 `plist 1.8.0 → 1.10.0`。

#### CI

- **移除 `pnpm audit` 步骤** — 项目使用 npmmirror（淘宝镜像）作为 npm 注册表，该镜像不支持 audit 端点，每次 CI 必然失败且与真实安全性无关，已移除。
- **修复 E2E 快照断言** — 移除 `grid.spec.ts` 中 `toHaveScreenshot('app-initial.png')` 调用；该测试的基线文件 `app-initial-chromium-linux.png` 从未提交到仓库，旧 CI 用 `--update-snapshots` 掩盖了此问题（测试在 CI 中自动写基线 → 永远通过 → 实际从未验证过视觉回归）。移除后 DOM 断言仍完整验证布局结构。
- **修复 Rust 格式** — 运行 `cargo fmt` 修正 `settings.rs` / `state.rs` / `pipeline.rs` / `photo_repository_test.rs` 中 rustfmt 不符项（长行折行、多行格式化）。
 ## [0.1.1] — 2026-08-04


### 2026-08-04 — Settings storage white screen & view-transition rendering fixes

#### Fixed

- **设置→存储 白屏** — Rust `storage_get_info` 返回的字段名（`thumbCacheBytes`/`thumbFileCount`）与前端 `StorageInfo` 契约（`thumbnailSizeBytes`/`thumbnailCount`）不一致，前端对 `undefined` 调用 `.toLocaleString()` 抛 TypeError，React 无错误边界 → 整树白屏。Rust 侧已按契约补齐 `thumbnailSizeBytes`/`thumbnailCount`/`dbSizeBytes`/`totalSizeBytes`；前端读取全部加 `?? 0` 兜底。
- **新增全局 ErrorBoundary** — 任何子组件渲染抛错不再白屏整棵应用，而是显示可恢复的降级界面（同类"字段缺失→崩溃"问题的系统性防护）。
- **启动闪屏** — `index.html` 硬编码 `class="dark"`，浅色/跟随系统用户在首帧会先闪一帧深色再被 `useTheme` 切换。改为首帧前内联脚本按 `prefers-color-scheme` 立即设主题；`MainContent` 首次挂载不再淡入。
- **切选项卡黑色停留动画 + 缩略图网格虚影** — `MainContent` 用 `mode="sync"` 让旧视图（含旧缩略图）与新视图在过渡期间重叠渲染，且新视图从透明淡入，露出黑色背景。改为 `mode="wait"`（旧视图完全卸载后才挂载新视图，消除虚影重叠）+ 视图容器实心 `bg-app` 背景（过渡间隙不再透出黑色）。

#### Security

#### Fixed

- **Dev/production data collision** — `AppState::new()` resolved the same `%APPDATA%\LightAlbum\` folder regardless of build mode, so `pnpm tauri dev` and the installed release shared one `library.db` and `thumbnails\` — locally-imported test photos showed up in the production app. Debug builds now use a sibling `LightAlbum-dev\` folder.
- **Orphaned thumbnail files on purge** — `photos_purge` / `photos_purge_data` deleted the DB row (and, for `photos_purge`, the original file) but never removed the generated `{hash}.{s,m,l}.webp` thumbnail files, leaving them on disk permanently. `ThumbnailCache`'s 5GB eviction threshold meant caches well under that size never got cleaned up at all. Both commands now delete the matching thumbnail files and evict the in-memory cache entry.
- **Trash auto-purge was dead code** — `purge_old_trash()` (the 30-day recycle-bin expiry) existed in the DB layer but was never called from anywhere in `lib.rs`, so items never actually expired. Wired up as a background task that runs shortly after startup and every 24h, and extended to also delete the expired items' original + thumbnail files (previously it only deleted DB rows).
- **Uninstaller left `%APPDATA%\LightAlbum\` behind** — the NSIS uninstaller only removed installed program files. Added a `NSIS_HOOK_POSTUNINSTALL` (`src-tauri/installer-hooks.nsh`) that prompts the user and, if they opt in, removes the app data folder (library.db + thumbnail cache; never the original photo files, which always live outside this folder).

### 2026-08-03 — Code-review hardening of the trash auto-purge & purge fixes

The initial fixes introduced two irreversible data-loss paths; both were caught in review and closed.

#### Fixed

- **Auto-purge deleted originals of watcher-marked photos (data loss)** — `mark_missing` (file watcher, triggered when a file disappears from disk — e.g. unplugged drive) set `is_deleted=1, deleted_at=now`, identical to user trash. The new 30-day purge would then permanently `remove_file` the original if it had reappeared on disk 30 days later. `mark_missing` now leaves `deleted_at` NULL, and `purge_old_trash` requires `deleted_at IS NOT NULL` — watcher-missing photos are never auto-purged (their files may just be temporarily offline).
- **Purge vs. restore race (data loss)** — `purge_old_trash` did a `SELECT` then an unguarded per-id `DELETE`; a photo restored between the two was still hard-deleted. Rewritten as a single atomic `DELETE ... RETURNING id, file_path, file_hash` with `is_deleted = 1` in the WHERE, closing the TOCTOU window (also removes the N+1 DELETE loop).
- **Shared-hash thumbnail deletion broke surviving photos** — thumbnails are keyed by `file_hash`, so byte-identical photos share the same `.webp` files; purging one deleted them all. `remove_thumbnails` now skips deletion when any other photo row (including trashed ones) still references the hash, and skips entirely for empty `file_hash` (which would otherwise collide on `{thumb_dir}/.s.webp`).
- **Queued thumbnail task regenerated orphan files after purge** — an in-flight `PipelineTask` could write thumbnails for a photo purged while queued, recreating the exact orphans the fix removed. `process_task` now checks the photo row is still active (exists and not trashed) before generating; DB failures do not skip (would lose legitimate thumbnails).
- **Auto-purge never told the frontend** — the background purge deleted rows/files but emitted no event, leaving ghost entries in TanStack Query (`staleTime: Infinity`) and the Zustand store. It now emits `library:changed` (`removed: [...]`) like every other library mutation.
- **Purge N+1 DB queries** — `photos_purge`/`photos_purge_data` prefetched via a per-id `get()` loop (up to 1000 serialized pool checkouts on a max-5 pool); replaced with a single `get_batch` IN(...) query. `remove_thumbnails` also takes the cache lock once instead of once per size.

#### Security

- **SEC-H3 — HMAC session token for private album authorization**
  - `album_verify_password` now returns a signed `base64url(payload).base64url(sig)` token on success instead of a plain boolean; `null` on failure
  - Token payload = `"{album_id}\n{expires_at_unix}"` signed with HMAC-SHA256; TTL = 3600 s
  - `AppState.hmac_secret` — 32-byte secret derived from two UUID v4 values (OS CSPRNG), regenerated on every app restart so tokens are automatically invalidated across sessions
  - `photos_list` now performs a backend authorization check: if `album_id` refers to a private album, a valid `session_token` is **required** in the filter; missing or expired tokens return `AppError::Other("TOKEN_REQUIRED")`
  - New `album_check_token` IPC command for proactive token validation from the frontend
  - Constant-time HMAC comparison (`constant_time_eq`) prevents timing-oracle attacks
  - New crate deps: `hmac 0.12`, `sha2 0.10`, `base64 0.22`
  - **Frontend wiring**: `AlbumContext` carries `sessionToken` + `onTokenExpired`; `PasswordLockScreen.onUnlock(token)` stores the token in `PrivateAlbumView`; `usePhotoQuery` injects `sessionToken` into `PhotoFilter`; `usePhotoData` detects `TOKEN_REQUIRED` errors and calls `onTokenExpired()` to re-lock the UI; navigating away from the album clears the token immediately

#### Fixed

- **PrivateAlbum PIN color consistency (v3)** — Replaced Framer Motion spring animation on filled `PinDot` cells with a plain `<div>` + CSS `transition` (`opacity`/`transform`); spring interpolation caused concurrently-mounted dots to be at different animation stages, making them appear different shades — CSS transition is deterministic and all filled cells now render identically
- **PrivateAlbum multi-album keydown isolation (v3)** — During an `AnimatePresence` transition between two private albums (~120 ms), both `PasswordLockScreen` instances were mounted simultaneously and both registered `window keydown` handlers, causing a single keystroke to trigger both `handleComplete` callbacks; fixed with a module-level `activeAlbumToken` string that the newest instance claims on mount, silencing stale listeners

#### Documentation

- **DOC-H1 — Rustdoc on all public Tauri commands** — Added `///` doc comments to every `#[tauri::command]` function in `commands/photo.rs`, `commands/album.rs`, `commands/settings.rs`, `commands/tag.rs`, and `commands/thumbnail.rs`; documents parameters, return types, error conditions, and key invariants (pagination cursors, private-album token requirement, bcrypt rate-limit behaviour, thumbnail priority queue)

---

### 2026-05-18 ~ 2026-05-19 — Comprehensive bug-fix batch

#### Security

- Private album PIN upgraded from 6-digit numeric to 8+ alphanumeric; bcrypt hash/verify moved off the async executor with `spawn_blocking`
- `AppState.db` field changed to `pub(crate)` to prevent direct SQL access bypassing the repository layer
- Added exponential back-off (≥3 failed attempts → lockout up to 5 min) on private album verification
- DEV-mode IPC log now redacts `password` field for `album_create_private`, `album_set_private`, `album_verify_password`
- **PrivateAlbum PIN input (v2)** — Replaced hidden `<input>` focus hack with `window.addEventListener('keydown')` to fix PIN digits being silently dropped when the hidden input lost focus; overlay click no longer dismisses the creation wizard mid-flow

#### Performance

- N+1 `get_batch` SQL replaced with single `IN (…)` query
- `usePhotoData` no longer re-flatMaps all pages on each scroll; uses `appendPhotos` for page 2+ (O(N²) → O(pageSize))
- `updatePhoto` in `photoStore` is now O(1) via `_photoIndex` map instead of O(N) `.map()` scan
- `thumb:batch_done` event now uses `resetQueries` to bypass `staleTime: Infinity`

#### Correctness

- `photos_purge` now collects file paths before DB delete (no dangling paths on rollback failure)
- `photos_update` uses repository `set_rating()` instead of raw SQL
- `AppError` gains explicit `ScanInProgress` and `UndoEmpty` variants; error codes align with frontend `IpcError` types
- `photoGroupKey` uses UTC methods to avoid timezone-induced month boundary shifts
- Undo recording errors now emit `tracing::warn` instead of silently discarding with `let _ =`
- `useEventBus` unlisten cleanup is now synchronous (was an async `Promise.allSettled` race)
- `albums_list_all` masks `cover_thumbnail` for private albums
- `AlbumUpdateParams` type unifies two-argument album update calls to a single typed object

#### React

- `usePhotoData` merges two separate `useEffect`s into one to prevent split-frame state
- Store updates in `usePhotoData` wrapped in `startTransition` for concurrency safety
- `PreviewToolbar` `favMutation` moved to true optimistic pattern (`onMutate` + `onError` rollback)
- `invalidateQueries(['photos'])` replaced with `resetQueries` at all favorite/batch-favorite call sites

#### CI

- Rust tests now use `--test-threads=$(nproc)` instead of hardcoded `4`
- Added `cargo audit` security scan to Rust job
- Added `pnpm audit --audit-level=high` to frontend job
- Added sidecar smoke test to frontend CI job
- Added E2E test job with `xvfb-run`
- `windows-compat` job upgraded with Clippy, frontend lint, and typecheck steps
- Added `release.yml` workflow triggered on version tags
- Added Dependabot config for npm, Cargo, and GitHub Actions

## [0.1.0] — 2026-04-26

### Added
- Photo import with recursive folder scanning and live file watching
- Virtualized waterfall grid with 4 density presets
- Full-screen photo preview with EXIF metadata panel and filmstrip navigation
- Album management with private album support (bcrypt password protection)
- Color-coded tag system with tag filter panel
- Full-text search across filenames, camera models, and metadata
- Trash with 30-day soft delete and restore
- Three-tier thumbnail pipeline with LRU cache and Sharp sidecar for HEIC/RAW
- Dark / Light / System theme support
- Batch operations (multi-select, drag-select, batch favorite/delete with undo)
- Undo support (Ctrl+Z) for delete, favorite, album add operations

### Architecture
- Tauri v2 + React 19 + TypeScript + Rust backend
- SQLite with WAL mode and r2d2 connection pool
- Repository trait pattern for decoupled data access layer
- Zustand v5 stores + TanStack Query v5 for state and cache management
