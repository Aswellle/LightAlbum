# Release Guide

> 发行系统使用**不可变发行账本**模型：一个版本号 = 一个 commit = 一个 Release，已发布的 Release / Tag 永不改写。
> 这些约束由 GitHub 侧的 Tag Ruleset、Immutable Releases 与 `release` environment 强制执行；此处只描述可执行流程。

## Versioning

四个文件必须一致，由 `pnpm version:check` 校验：

| 文件 | 字段 |
|---|---|
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `[package] version` |
| `src-tauri/Cargo.lock` | `[[package]] light-album` 的 `version` |

只改 `package.json`，其余由脚本同步（禁止手改，容易漏 `Cargo.lock`）：

```bash
pnpm version:set 0.4.1      # 同步四个文件到指定版本
pnpm version:bump patch     # 或 minor / major（按 package.json 当前值推导）
pnpm version:check          # 校验四者一致
```

版本号语义：`patch` = 仅修复；`minor` = 体验/功能升级（0.x 下的常规发行）；`major` = 稳定承诺。

## Release process

### 1. Prepare

- `CHANGELOG.md`：把 `[Unreleased]` 提升为新版本小节（`## [0.4.1] — YYYY-MM-DD`），条目按 Added / Changed / Fixed 归类。
- 写 `release_notes.md`：**用户视角**的发行说明，按「实现 / 添加 / 修复」分条，不含文件名、组件名、令牌等实现细节——它会被用作 GitHub Release 正文。
- 提交：`chore(release): bump version to X.Y.Z and update CHANGELOG`。

> **版本号不用手改**：`pnpm version:set X.Y.Z`（或 `pnpm version:bump …`）会把
> `package.json` / `tauri.conf.json` / `Cargo.toml` / `Cargo.lock` **与 `release_notes.md`**
> （标题行 + 下载文件名）一起同步到目标版本；`pnpm version:check` 在 `release_notes.md`
> 与四文件不一致时直接失败，避免把上一版的文件名发出去。正文里的历史版本引用不会被改写。

### 2. Preflight and tag（不要手写 `git tag`）

```bash
pnpm release:preflight v0.4.1   # tag 格式 · 版本一致 · 在 main 上 · 工作树干净 · 远端无重名 tag · 非不可变版本
pnpm release:tag v0.4.1         # 创建**附注** tag 并推送 → 触发 Release workflow
```

参数直接跟在脚本名后（`pnpm release:tag -- v0.4.1` 会把 `--` 原样传给脚本并报错）。脚本是 create-only：不会删除或覆盖任何已有 tag。

### 3. What the workflow does

```
Preflight → Full CI (workflow_call) → Create Draft Release (release_id)
  → Build Windows x64 / macOS Apple Silicon / Linux x64（同一 release_id）
  → Verify Assets（三个平台各自的产物都在 · 仍为 Draft）
  → release Environment（人工批准）
  → Publish → 不可变
```

### 4. Finalize（必须在发布前完成——发布后不可改写）

1. Releases 页面打开 Draft，确认三个平台的资产齐全（命名见文末表格）。
2. 正文**不需要手工替换**：`prepare-release` 用 `--notes-file release_notes.md` 创建 Draft（文件缺失时才退回 `--generate-notes`）。若在创建 Draft 后改过 `release_notes.md`，重跑 workflow 会重新同步正文；Draft 状态允许编辑，一旦 Publish 即不可变。
3. 批准 `release` environment 的 deployment（Actions → 该 run → Review deployments），workflow 完成 Publish。

## GitHub environment settings（必需，一次性）

`release` environment 除了 **Required reviewers**，还必须**允许 tag 部署**。否则 publish 作业会失败：

> Tag "v0.4.0" is not allowed to deploy to release due to environment protection rules.

Settings → Environments → `release` → **Deployment branches and tags** → Edit:

- *Selected branches and tags* → 添加一条 **Tag** 规则，pattern `v*`（推荐，作用域最小）；或
- *All branches*（宽松）。

注意：`Protected branches only` 永远不匹配 tag——这正是默认/常见配置下 tag 发行被拒的原因。Required reviewers 是另一道门，**不能替代**该规则：被规则拒绝的 deployment 根本不会进入等待批准状态。

其余一次性设置（**Immutable Releases**、**Tag Ruleset**）：

- Settings → General → Releases → Enable release immutability（对 v0.2.0+ 生效）。
- Settings → Rules → Rulesets → Target Tag `v*` → Restrict creations、Block force pushes、Restrict updates。

## Failure recovery

| 场景 | 处理 |
|---|---|
| CI 失败 | 修代码 → main → **新版本号**；绝不移动失败的 tag |
| 单平台构建失败（Tag / Commit 未变，Release 仍为 Draft） | Actions → 该 run → **Re-run failed jobs** |
| publish 被 environment 规则拒绝 | 按上节补 tag 规则 → **Re-run failed jobs**（Tag / Commit 未变，允许重跑） |
| Draft 的正文/标题不合格 | Publish 之前用 `gh release edit --notes-file` 或网页编辑 |
| 已发布后发现 bug | 新版本号（0.4.2）→ 新 tag → 新 Release；**禁止**重传资产或改写已发布 Release |

## Code signing

### Windows

Unsigned Windows builds trigger SmartScreen warnings. To sign:
1. Obtain an EV code-signing certificate from a CA (DigiCert, Sectigo, etc.).
2. Add the certificate as GitHub Actions secrets: `WINDOWS_CERTIFICATE` (Base64 PFX) + `WINDOWS_CERTIFICATE_PASSWORD`.
3. Add signing config to `tauri.conf.json` under `bundle.windows.certificateThumbprint` or use environment variables per the Tauri docs.

### macOS

Distributing outside the Mac App Store requires notarization:
1. Enroll in the Apple Developer Program.
2. Create an App ID, provisioning profile, and distribution certificate.
3. Add secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_PASSWORD`.
4. Configure the `tauri-action` in `release.yml` with the signing environment variables.

## Build artifacts

`bundle.targets = "all"`，产物按 Tauri 默认命名（`{productName}_{version}_{arch}[_{locale}]`，Linux 使用小写包名）：

| 平台 | 产物 |
|------|----------|
| Windows | `LightAlbum_x.y.z_x64-setup.exe`（NSIS）、`LightAlbum_x.y.z_x64_en-US.msi` |
| macOS | `LightAlbum_x.y.z_aarch64.dmg`（Apple Silicon；另附 `.app.tar.gz` 更新包）—— 不再提供 Intel 版本 |
| Linux | `LightAlbum_x.y.z_amd64.AppImage`、`LightAlbum_x.y.z_amd64.deb`、`LightAlbum-x.y.z-1.x86_64.rpm` |

产物名以 `gh release view <tag> --json assets` 的实际列表为准；`v0.4.0` 的实际资产为 9 个（上表 7 个 + 两个 `.app.tar.gz` 更新包）。

## Hotfix releases

For critical fixes (security vulnerabilities, data-loss bugs):
1. Branch from the release tag: `git checkout -b hotfix/0.1.1 v0.1.0`
2. Apply the minimum fix.
3. Update version + CHANGELOG, tag `v0.1.1` via `pnpm release:tag v0.1.1`, push.
4. Merge the hotfix branch back to `main`.
