// src-tauri/src/commands/export.rs
//
// 照片导出（复制 / HEIC·RAW 转码）
//
// 命令：
//   photos_export — 将所选照片导出到目标目录，可转成 JPEG / PNG
//
// 策略：
//   - JPEG/PNG 源 + format="auto" + 未指定 quality/maxDim → std::fs::copy 直拷
//     （无损、零解码开销）
//   - 其余情况（HEIC/RAW 源，或用户指定了格式/质量/尺寸）→ Sharp sidecar 解码转码
//     （与缩略图/预览共用同一条 HEIC/RAW 解码路径）
//   - 目标目录已存在同名文件时自动改名 "name (2).jpg"、"name (3).jpg"…，绝不覆盖
//   - 单张失败不中断整批：计入 failed，明细最多 20 条
//   - 每处理完一张 emit "export:progress" { done, total, current }
//
// sidecar 是阻塞式 stdin/stdout 单例（SidecarHandle 内部持 std::sync::Mutex），
// 因此整批工作放在 spawn_blocking 线程中执行，避免阻塞 tokio 工作线程。

use crate::db::photo::Photo;
use crate::db::PhotoRepository;
use crate::error::AppError;
use crate::state::AppState;
use crate::thumbnail::sidecar::SidecarHandle;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

/// 失败明细上限（整批失败数仍完整计入 failed）
const MAX_FAILURES: usize = 20;

/// 直拷路径的扩展名白名单（小写）
const COPY_EXTS: &[&str] = &["jpg", "jpeg", "png"];

// ─────────────────────────────────────────────────────────
//  返回值
// ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ExportFailure {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportSummary {
    /// 成功导出的总数（copied + converted）
    pub exported: u32,
    /// 其中原样复制的张数
    pub copied: u32,
    /// 其中转码导出的张数
    pub converted: u32,
    /// 失败张数
    pub failed: u32,
    /// 失败明细（最多 MAX_FAILURES 条）
    pub failures: Vec<ExportFailure>,
}

/// `export:progress` 事件 payload（前端 ExportProgressPayload）
#[derive(Debug, Clone, Serialize)]
struct ExportProgress {
    done: u32,
    total: u32,
    current: String,
}

/// 单张导出结果
enum Outcome {
    Copied,
    Converted,
}

// ─────────────────────────────────────────────────────────
//  photos_export
// ─────────────────────────────────────────────────────────

/// 导出所选照片到 `dest_dir`。
///
/// - `format`：`"auto"` 跟随源文件（仅 JPEG/PNG 直拷，其余转 JPEG），或强制 `"jpeg"` / `"png"`
/// - `quality`：JPEG 质量 1-100（PNG 忽略）
/// - `max_dim`：最长边上限（等比、不放大；None 保持原尺寸）
#[tauri::command]
pub async fn photos_export(
    photo_ids: Vec<String>,
    dest_dir: String,
    format: String,
    quality: Option<u32>,
    max_dim: Option<u32>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExportSummary, AppError> {
    // ── 参数校验 ──────────────────────────────────────────
    if !matches!(format.as_str(), "auto" | "jpeg" | "png") {
        return Err(AppError::InvalidArgument(format!(
            "不支持的导出格式: {format}（应为 auto/jpeg/png）"
        )));
    }
    if let Some(q) = quality {
        if !(1..=100).contains(&q) {
            return Err(AppError::InvalidArgument(format!(
                "导出质量需在 1-100 之间: {q}"
            )));
        }
    }
    if max_dim == Some(0) {
        return Err(AppError::InvalidArgument("最长边上限必须大于 0".into()));
    }
    if photo_ids.is_empty() {
        return Ok(ExportSummary {
            exported: 0,
            copied: 0,
            converted: 0,
            failed: 0,
            failures: Vec::new(),
        });
    }

    // 目标目录：侧车只负责写文件，父目录由调用方保证
    let dest_dir = PathBuf::from(dest_dir);
    std::fs::create_dir_all(&dest_dir)?;

    let photos = Arc::clone(&state.photos);
    let sidecar = Arc::clone(&state.sidecar);

    // SidecarHandle 是阻塞式 std Mutex 单例，整批放到阻塞线程池执行
    let joined = tokio::task::spawn_blocking(move || {
        run_export(
            &photos, &sidecar, &photo_ids, &dest_dir, &format, quality, max_dim, &app,
        )
    })
    .await
    .map_err(|e| AppError::Other(format!("导出任务执行失败: {e}")))?;

    joined
}

// ─────────────────────────────────────────────────────────
//  批量导出核心（同步，运行在 spawn_blocking 线程）
// ─────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
fn run_export(
    photos: &Arc<dyn PhotoRepository>,
    sidecar: &Arc<Mutex<SidecarHandle>>,
    photo_ids: &[String],
    dest_dir: &Path,
    format: &str,
    quality: Option<u32>,
    max_dim: Option<u32>,
    app: &AppHandle,
) -> Result<ExportSummary, AppError> {
    let total = photo_ids.len() as u32;
    let mut done: u32 = 0;
    let mut summary = ExportSummary {
        exported: 0,
        copied: 0,
        converted: 0,
        failed: 0,
        failures: Vec::new(),
    };

    // 一次性批量取记录（避免 N 次连接池取用），再按入参顺序遍历
    let mut by_id: HashMap<String, Photo> = photos
        .get_batch(photo_ids)?
        .into_iter()
        .map(|p| (p.id.clone(), p))
        .collect();

    for id in photo_ids {
        // ── 取照片记录 ────────────────────────────────────
        let Some(photo) = by_id.remove(id) else {
            push_failure(&mut summary, id.clone(), "照片记录不存在".into());
            done += 1;
            emit_progress(app, done, total, id);
            continue;
        };

        let name = photo.file_name.clone();

        // ── 复制或转码 ────────────────────────────────────
        match export_one(&photo, dest_dir, format, quality, max_dim, sidecar) {
            Ok(Outcome::Copied) => {
                summary.copied += 1;
                summary.exported += 1;
            }
            Ok(Outcome::Converted) => {
                summary.converted += 1;
                summary.exported += 1;
            }
            Err(reason) => push_failure(&mut summary, name.clone(), reason),
        }

        done += 1;
        emit_progress(app, done, total, &name);
    }

    Ok(summary)
}

fn emit_progress(app: &AppHandle, done: u32, total: u32, current: &str) {
    let _ = app.emit(
        "export:progress",
        ExportProgress {
            done,
            total,
            current: current.to_string(),
        },
    );
}

fn push_failure(summary: &mut ExportSummary, name: String, reason: String) {
    summary.failed += 1;
    if summary.failures.len() < MAX_FAILURES {
        summary.failures.push(ExportFailure { name, reason });
    }
}

// ─────────────────────────────────────────────────────────
//  单张导出
// ─────────────────────────────────────────────────────────

/// 导出单张照片，返回直拷 / 转码结果或失败原因
fn export_one(
    photo: &Photo,
    dest_dir: &Path,
    format: &str,
    quality: Option<u32>,
    max_dim: Option<u32>,
    sidecar: &Arc<Mutex<SidecarHandle>>,
) -> std::result::Result<Outcome, String> {
    let src = Path::new(&photo.file_path);
    if !src.is_file() {
        return Err("源文件不存在".into());
    }

    let src_ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| photo.file_name.clone());

    let is_plain = COPY_EXTS.contains(&src_ext.as_str());

    // ── 直拷：JPEG/PNG 源 + auto + 无质量/尺寸要求 ───────
    if format == "auto" && is_plain && quality.is_none() && max_dim.is_none() {
        let dest = unique_path(dest_dir, &stem, &src_ext);
        std::fs::copy(src, &dest).map_err(|e| format!("复制失败: {e}"))?;
        return Ok(Outcome::Copied);
    }

    // ── 转码：决定目标扩展名与侧车输出格式 ───────────────
    let (dest_ext, sidecar_format) = match format {
        "png" => ("png", "png"),
        "jpeg" => ("jpg", "jpeg"),
        // auto：源是 PNG 则保持 PNG（无损），其余（HEIC/RAW/其他）一律转 JPEG
        _ => {
            if is_plain && src_ext == "png" {
                ("png", "png")
            } else {
                ("jpg", "jpeg")
            }
        }
    };

    let dest = unique_path(dest_dir, &stem, dest_ext);
    let sidecar_quality = if sidecar_format == "png" {
        None
    } else {
        Some(quality.unwrap_or(90))
    };

    let resp = {
        let mut sc = sidecar
            .lock()
            .map_err(|_| "sidecar 状态锁已损坏".to_string())?;
        sc.request_export(src, &dest, sidecar_format, sidecar_quality, max_dim)
            .map_err(|e| format!("转码失败: {e}"))?
    };

    if !resp.ok {
        // 失败时清掉可能写了一半的产物，避免污染目标目录
        let _ = std::fs::remove_file(&dest);
        return Err(resp
            .error
            .unwrap_or_else(|| "转码失败: 侧车返回未知错误".into()));
    }

    Ok(Outcome::Converted)
}

/// 生成不覆盖已有文件的目标路径：
/// `stem.ext` → 冲突时 `stem (2).ext` → `stem (3).ext` …
fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{stem}.{ext}"));
    let mut n: u32 = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    candidate
}
