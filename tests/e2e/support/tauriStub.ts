/**
 * @file tests/e2e/support/tauriStub.ts
 * @description 共用的假 Tauri IPC + 逐帧探针（测试基建）
 *
 * 为什么集中在一处：
 *   1. **契约**：列表类命令必须返回数组。组件里的 `const { data: x = [] } = useQuery(...)`
 *      默认值只对 `undefined` 生效——stub 返回 `null` 会直接落到 `.length` 上抛错，
 *      把应用打进 ErrorBoundary（曾让断言时好时坏并阻断一次发行）。
 *      因此这里对所有 `*_list` / `*_all` / `*_batch` 形状的命令统一兜底为 `[]`，其余返回 `null`。
 *   2. **探针**：页面静止时 CI 的合成器可能不再产生 rAF 帧，只靠 rAF 会漏采整段窗口，
 *      让「不闪烁」的断言变成「没采到 = 没闪」的假通过。这里 rAF 与 50ms 心跳同时采样，
 *      并统一记录「界面是否已崩进错误边界」。
 */

import { expect, type Page } from '@playwright/test'

// ─────────────────────────────────────────────────────────
//  类型
// ─────────────────────────────────────────────────────────

export interface StubPhoto {
  id:           string
  filePath:     string
  fileName:     string
  fileSize:     number
  fileHash:     string
  width:        number
  height:       number
  orientation:  number
  format:       string
  createdAt:    string
  modifiedAt:   string
  importedAt:   string
  folderPath:   string
  gpsLat:       null
  gpsLng:       null
  cameraMake:   null
  cameraModel:  null
  lensModel:    null
  focalLength:  null
  aperture:     null
  shutterSpeed: null
  iso:          null
  isFavorite:   boolean
  rating:       number
  isDeleted:    boolean
  tags:         string[]
}

export interface InvokeRecord {
  cmd:     string
  /** photos_list 的命令参数（形状未校验，断言方按需读取） */
  filter?: Record<string, unknown>
  /** photos_get / photo_tags_get 等按 id 调用的命令参数 */
  id?:     string
  /** 完整命令参数（形状未校验，断言方按需读取；如 photos_export 的 destDir/format） */
  args?:   Record<string, unknown>
}

export interface ProbeFrame {
  /** 页面内 performance.now() */
  ts:          number
  /** 内容区 data-grid-state（none = 网格未挂载） */
  gridState:   string
  /** 已渲染格子数 */
  gridItems:   number
  /** 状态栏首个数（照片计数） */
  statusTotal: number
  /** 大图预览覆盖层是否在 DOM 中 */
  previewOpen: boolean
  /** 预览内的 <img> 数量 */
  previewImgs: number
  /** 预览内第一张 <img> 的渲染宽度（px，含 transform）——用于断言飞入过程 */
  previewImgW: number
  /** 侧边栏空态引导文案 */
  albumHint:   boolean
  tagHint:     boolean
  /** 是否已崩进错误边界（界面被替换为「界面渲染出错」） */
  crashed:     boolean
}

export interface StubOptions {
  /** 「所有照片」数据集（默认 12 张） */
  photos?:    StubPhoto[]
  /** 收藏视图数据集（默认 6 张） */
  favorites?: StubPhoto[]
  /** 标签视图数据集（默认 4 张） */
  tagged?:    StubPhoto[]
  /** 侧边栏标签（默认一个「旅行」，photoCount 取 tagged 数量） */
  tags?:      Array<{ id: string; name: string; color: string; photoCount: number }>
  /** 列表类命令的响应延迟（毫秒）——用于人为放大启动/加载窗口 */
  delayMs?:   number
  /** 覆盖 settings_get 的部分字段（如两个预览行为开关） */
  settings?:  {
    theme?:                string
    gridDensity?:          number
    previewOnDoubleClick?: boolean
    autoHidePreviewUI?:    boolean
  }
}

const THUMB_DATA_URL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

// ─────────────────────────────────────────────────────────
//  数据工厂
// ─────────────────────────────────────────────────────────

/**
 * 生成按时间**有序**（后端返回即有序）的照片数据。
 * 顺序很重要：分组按 createdAt 的月份切分，乱序会让相邻照片落进不同分组。
 */
export function makePhotos(
  prefix: string,
  count: number,
  options: { isFavorite?: boolean } = {},
): StubPhoto[] {
  const { isFavorite = false } = options
  return Array.from({ length: count }, (_, i) => ({
    id:           `${prefix}-${i}`,
    filePath:     `C:/photos/${prefix}/${i}.jpg`,
    fileName:     `${prefix}-${i}.jpg`,
    fileSize:     1024 * (i + 1),
    fileHash:     `${prefix}-hash-${i}`,
    width:        1200,
    height:       800,
    orientation:  1,
    format:       'jpeg',
    createdAt:    new Date(Date.UTC(2025, 5, 28 - i, 10, 0, 0)).toISOString(),
    modifiedAt:   new Date(Date.UTC(2025, 5, 28, 10, 0, 0)).toISOString(),
    importedAt:   new Date(Date.UTC(2025, 5, 28, 10, 0, 0)).toISOString(),
    folderPath:   'C:/photos',
    gpsLat:       null,
    gpsLng:       null,
    cameraMake:   null,
    cameraModel:  null,
    lensModel:    null,
    focalLength:  null,
    aperture:     null,
    shutterSpeed: null,
    iso:          null,
    isFavorite,
    rating:       0,
    isDeleted:    false,
    tags:         [],
  }))
}

// ─────────────────────────────────────────────────────────
//  安装
// ─────────────────────────────────────────────────────────

/** 注入假 IPC 与逐帧探针（必须在 page.goto 之前调用） */
export async function installTauriStub(page: Page, options: StubOptions = {}): Promise<void> {
  const photos    = options.photos    ?? makePhotos('p', 12)
  const favorites = options.favorites ?? makePhotos('fav', 6, { isFavorite: true })
  const tagged    = options.tagged    ?? makePhotos('tag', 4)
  const tags      = options.tags      ?? [
    { id: 'tag-1', name: '旅行', color: '#0A84FF', photoCount: tagged.length },
  ]
  const delayMs   = options.delayMs   ?? 0
  const settings  = options.settings  ?? {}
  const thumb     = THUMB_DATA_URL

  await page.addInitScript(
    ({ photos, favorites, tagged, tags, delayMs, settings, thumb }) => {
      const w = window as unknown as {
        __TAURI_INTERNALS__?: unknown
        __invokes?: InvokeRecord[]
        __frames?: ProbeFrame[]
        __stubListResolvedAt?: number
        [k: string]: unknown
      }

      const sleep = (ms: number) => {
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, ms)
        return promise
      }

      const page1 = (items: unknown[]) => ({
        items,
        nextCursor: null,
        total: items.length,
      })

      w.__TAURI_INTERNALS__ = {
        transformCallback(cb: unknown) {
          const id = Math.floor(Math.random() * 1_000_000_000)
          w[`_${id}`] = cb
          return id
        },
        // 预览用 convertFileSrc 取原图 URL；测试里复用缩略图 data URL，
        // 让「原图」也能立即加载完成（覆盖底图 → 原图的交叉淡变路径）
        convertFileSrc: (_path: string) => thumb,
        async invoke(cmd: string, args?: Record<string, unknown>) {
          w.__invokes?.push({
            cmd,
            filter: args?.filter as Record<string, unknown> | undefined,
            id:     args?.id as string | undefined,
            args,
          })

          // 文件夹选择对话框（tauri-plugin-dialog）：测试里固定返回一个假目录
          if (cmd.startsWith('plugin:dialog|')) return 'C:\\e2e-export-out'

          switch (cmd) {
            case 'photos_reveal':
              return null

            case 'photos_export': {
              const ids = (args?.photoIds as string[] | undefined) ?? []
              return {
                exported:  ids.length,
                copied:    ids.length,
                converted: 0,
                failed:    0,
                failures:  [],
              }
            }

            case 'settings_get':
              return {
                theme: 'dark',
                gridDensity: 2,
                sortBy: 'created_at',
                sortAsc: false,
                watchedFolders: [],
                sidebarWidth: 220,
                autoHidePreviewUI: true,
                previewOnDoubleClick: false,
                ...settings,
              }
            case 'photos_list': {
              if (delayMs) await sleep(delayMs)
              const filter = args?.filter as Record<string, unknown> | undefined
              if (filter?.favoritesOnly === true) return page1(favorites)
              if (filter?.isDeleted === true) return page1([])
              return page1(photos)
            }
            case 'photos_get':
              return (
                photos.find((p) => p.id === args?.id) ??
                favorites.find((p) => p.id === args?.id) ??
                tagged.find((p) => p.id === args?.id) ??
                photos[0]
              )
            case 'photos_get_batch':
              return photos
            case 'search_photos':
              return page1(tagged)
            case 'thumbnail_get_path':
              return thumb
            case 'thumbnail_request':
              return null
            case 'search_stats':
              if (delayMs) await sleep(delayMs)
              return {
                totalPhotos:    photos.length,
                totalAlbums:    0,
                totalTags:      tags.length,
                totalSizeBytes: 0,
              }
            case 'albums_list':
            case 'albums_list_all':
              if (delayMs) await sleep(delayMs)
              // 列表数据真正到达的时刻：此前的空态提示都属于「闪烁」
              w.__stubListResolvedAt = performance.now()
              return []
            case 'tags_list':
              if (delayMs) await sleep(delayMs)
              return tags
            case 'folders_list':
              if (delayMs) await sleep(delayMs)
              return []
            case 'photo_tags_get':
            case 'photo_tags_list':
              return []
            default:
              // 形状兜底：未显式处理的列表类命令一律返回数组。
              // `const { data = [] }` 的默认值只对 undefined 生效，返回 null 会崩进错误边界。
              return /(_list|_all|_batch)$/.test(cmd) ? [] : null
          }
        },
      }

      w.__invokes = []
      const frames: ProbeFrame[] = []
      w.__frames = frames

      const sample = () => {
        const text        = document.body.textContent ?? ''
        const grid        = document.querySelector('[data-testid="photo-grid"]')
        const preview     = document.querySelector('[data-testid="preview-root"]')
        const previewImg  = preview?.querySelector('img')
        const footerText  = document.querySelector('footer')?.textContent ?? ''
        const statusMatch = /(\d+)/.exec(footerText)
        frames.push({
          ts:          performance.now(),
          gridState:   grid ? grid.getAttribute('data-grid-state') ?? 'unknown' : 'none',
          gridItems:   document.querySelectorAll('.la-grid-item').length,
          statusTotal: statusMatch ? Number(statusMatch[1]) : -1,
          previewOpen: Boolean(preview),
          previewImgs: preview ? preview.querySelectorAll('img').length : 0,
          previewImgW: previewImg ? previewImg.getBoundingClientRect().width : 0,
          albumHint:   text.includes('暂无相册'),
          tagHint:     text.includes('暂无标签'),
          crashed:     text.includes('界面渲染出错'),
        })
      }

      // rAF（贴近绘制）+ 定时心跳（空闲期也覆盖）——见文件头说明
      window.requestAnimationFrame(function loop() {
        sample()
        window.requestAnimationFrame(loop)
      })
      window.setInterval(sample, 50)
    },
    { photos, favorites, tagged, tags, delayMs, settings, thumb },
  )
}

// ─────────────────────────────────────────────────────────
//  读取
// ─────────────────────────────────────────────────────────

/** 读取并原地清空逐帧采样（必须原地清空：采样闭包持有同一数组引用） */
export async function drainProbe(page: Page): Promise<ProbeFrame[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __frames?: ProbeFrame[] }
    const frames = w.__frames ?? []
    const drained = frames.slice()
    frames.length = 0
    return drained
  })
}

/** 最近一帧采样（探针未启动时抛出，便于定位「stub 是否在 goto 之前安装」） */
export async function lastProbe(page: Page): Promise<ProbeFrame> {
  const frame = await page.evaluate(() => {
    const w = window as unknown as { __frames?: ProbeFrame[] }
    const frames = w.__frames ?? []
    return frames.length > 0 ? frames[frames.length - 1] : null
  })
  if (!frame) throw new Error('逐帧探针没有产出采样：installTauriStub 必须在 page.goto 之前调用')
  return frame
}

/** 已发出的 IPC 命令记录 */
export async function readInvokes(page: Page): Promise<InvokeRecord[]> {
  return page.evaluate(
    () => (window as unknown as { __invokes?: InvokeRecord[] }).__invokes ?? [],
  )
}

/** 列表数据（相册/标签等）真正到达页面的时刻 */
export async function readListResolvedAt(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __stubListResolvedAt?: number }).__stubListResolvedAt ?? 0,
  )
}

// ─────────────────────────────────────────────────────────
//  等待与逐帧断言
// ─────────────────────────────────────────────────────────

/** 等待内容区渲染出至少 minItems 个格子 */
export async function waitForGridItems(page: Page, minItems = 1): Promise<void> {
  await expect
    .poll(async () => (await lastProbe(page)).gridItems, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(minItems)
}

/** 等待内容区进入 content 且状态栏计数为 expectedTotal */
export async function waitForView(page: Page, expectedTotal: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const p = await lastProbe(page)
        return { state: p.gridState, total: p.statusTotal }
      },
      { timeout: 15_000 },
    )
    .toMatchObject({ state: 'content', total: expectedTotal })
}

/**
 * 逐帧不变量（内容区）：
 *   - 不允许崩进错误边界
 *   - 不允许出现空态帧
 *   - 不允许出现「content 但 0 格」的空白帧
 */
export function assertNoBlankOrEmptyFrames(frames: ProbeFrame[]): void {
  const trace = frames.map((f) => `${f.gridState}/${f.gridItems}@${Math.round(f.ts)}`).join(' ')
  expect(frames.filter((f) => f.crashed).length, `crashed: ${trace}`).toBe(0)
  expect(frames.map((f) => f.gridState), trace).not.toContain('empty')
  for (const f of frames.filter((x) => x.gridState === 'content')) {
    expect(f.gridItems, `blank content frame: ${trace}`).toBeGreaterThan(0)
  }
}

/** 断言当前没有渲染异常（界面未被错误边界替换） */
export async function expectNoRenderCrash(page: Page): Promise<void> {
  await expect(page.getByText('界面渲染出错')).toHaveCount(0)
}
