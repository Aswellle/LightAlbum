// src-tauri/src/commands/reveal.rs
//
// 「在资源管理器中显示」IPC 命令
//
// 需求：从网格右键菜单 / 预览工具栏，用系统文件管理器定位到该照片的原始文件。
//
// 实现约束：
//   * 不新增任何依赖或 Tauri 插件，直接使用 std::process::Command 调用平台自带工具。
//   * 定位方式（按平台）
//       Windows：explorer /select,"<path>"   —— 打开父目录并选中该文件
//       macOS  ：open -R "<path>"            —— Finder 中显示（Reveal in Finder）
//       Linux  ：xdg-open "<父目录>"         —— 无统一「选中」机制，退化为打开所在目录
//
// 注意（Windows）：explorer.exe 即使在成功定位的情况下也常常返回退出码 1，
// 因此这里只把「进程启动失败」（Command::spawn 出错）视为错误，不检查退出码，
// 否则会把正常的成功调用误报为失败。

use crate::error::AppError;
use crate::state::AppState;
use std::path::Path;
use std::process::Command;
use tauri::State;

/// 在系统文件管理器中显示指定照片的原始文件。
///
/// 找不到照片记录 → PHOTO_NOT_FOUND；记录的 file_path 已不在磁盘上 → PHOTO_NOT_FOUND
/// （前端文案：找不到该照片，可能已被移动或删除）；
/// 无法启动文件管理器进程 → IO_ERROR。
#[tauri::command]
pub async fn photos_reveal(photo_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let photo = state
        .photos
        .get(&photo_id)?
        .ok_or_else(|| AppError::NotFound(format!("Photo {photo_id} not found")))?;

    let path = photo.file_path;
    if !Path::new(&path).exists() {
        // 消息中固定包含 "photo"，保证序列化为稳定的 PHOTO_NOT_FOUND 码，
        // 不因路径文本（例如目录名含 "album"/"folder"）而漂移。
        return Err(AppError::NotFound(format!(
            "Photo file not found on disk: {path}"
        )));
    }

    reveal_in_file_manager(&path)
}

// ─────────────────────────────────────────────────────────
//  平台相关定位
// ─────────────────────────────────────────────────────────

fn reveal_in_file_manager(path: &str) -> Result<(), AppError> {
    platform_command(path).spawn().map_err(|e| {
        AppError::Io(std::io::Error::new(
            e.kind(),
            format!("无法打开文件管理器定位 {path}：{e}"),
        ))
    })?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn platform_command(path: &str) -> Command {
    // /select,"<path>" 必须是单个参数，且路径带引号以容纳空格。
    let mut cmd = Command::new("explorer");
    cmd.arg(format!("/select,\"{path}\""));
    cmd
}

#[cfg(target_os = "macos")]
fn platform_command(path: &str) -> Command {
    let mut cmd = Command::new("open");
    cmd.arg("-R").arg(path);
    cmd
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn platform_command(path: &str) -> Command {
    // 无跨桌面环境统一的「选中文件」协议，退化为打开所在目录。
    let parent = Path::new(path)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| Path::new(".").to_path_buf());
    let mut cmd = Command::new("xdg-open");
    cmd.arg(parent);
    cmd
}
