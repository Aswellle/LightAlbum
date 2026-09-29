/**
 * @file scripts/release-notes.mjs
 * @description 发行说明（release_notes.md）中的版本号同步与校验
 *
 * 背景：`release_notes.md` 是 GitHub Release 正文的唯一来源（prepare-release 用它创建 draft），
 * 但里面的版本号此前需要发版时手改（标题 + 6 个下载文件名），漏改就会把上一版的文件名发出去。
 *
 * 这里只改**明确的两类形状**，避免误伤正文里可能出现的「历史版本」引用：
 *   1. 标题行：`# LightAlbum vX.Y.Z`
 *   2. 下载文件名：`LightAlbum_X.Y.Z_...` / `LightAlbum-X.Y.Z-...`
 */

/** 标题行：`# LightAlbum v1.2.3` */
const TITLE_RE = /^# LightAlbum v\d+\.\d+\.\d+$/m

/** 文件名前缀：`LightAlbum_1.2.3` 或 `LightAlbum-1.2.3`（保留分隔符） */
const FILENAME_RE = /LightAlbum([_-])\d+\.\d+\.\d+/g

/** 把发行说明里的目标版本号替换为 `version`（未出现则原样返回） */
export function rewriteReleaseNotes(source, version) {
  return source
    .replace(TITLE_RE, `# LightAlbum v${version}`)
    .replace(FILENAME_RE, (_match, sep) => `LightAlbum${sep}${version}`)
}

/**
 * 收集发行说明中「当前版本位」上出现的版本号（标题 + 文件名）。
 * 返回去重后的数组；没有任何版本号则返回空数组（例如说明尚未填写下载表）。
 */
export function collectReleaseNoteVersions(source) {
  const versions = new Set()

  const title = source.match(TITLE_RE)
  if (title) versions.add(title[0].replace(/^# LightAlbum v/, ''))

  for (const match of source.matchAll(FILENAME_RE)) {
    versions.add(match[0].replace(/^LightAlbum[_-]/, ''))
  }

  return [...versions]
}

/**
 * 校验发行说明是否与目标版本一致。
 * 返回 `{ ok: true }` 或 `{ ok: false, found }`（found = 文件中出现的版本号集合）。
 */
export function checkReleaseNotes(source, version) {
  const found = collectReleaseNoteVersions(source)
  if (found.length === 0) return { ok: true, found }
  return { ok: found.every((v) => v === version), found }
}
