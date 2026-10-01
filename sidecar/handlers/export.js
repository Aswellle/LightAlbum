'use strict';
// sidecar/handlers/export.js
//
// 导出为 JPEG / PNG（HEIC / RAW 转码）
//
// 与 decode.js / thumbnail.js 共用同一条解码路径：
//   sharp(input, { failOnError:false, limitInputPixels:false, sequentialRead:true })
//     .rotate()   ← EXIF 方向校正
//     .resize()   ← 仅当 maxDim 有值时
//     .jpeg()/.png()
//     .toFile(dest)
// 解码全部交给 libvips（HEIC 走 libheif，RAW 走其内建 loader），
// 不另起解码路径。
//
// 请求格式：
//   {
//     cmd:     "export",
//     src:     "/abs/path/IMG_0001.HEIC",
//     dest:    "/abs/path/out/IMG_0001.jpg",
//     format:  "jpeg" | "png",
//     quality: 90,        // 可选，仅 jpeg 生效（1-100，默认 90）
//     maxDim:  2560       // 可选，最长边上限（等比、不放大）
//   }
//
// 响应格式：
//   { ok: true,  path: "/abs/path/out/IMG_0001.jpg", width: 4032, height: 3024 }
//   { ok: false, error: "..." }
//
// 说明：
//   - 目标文件的父目录由调用方（Rust）保证存在
//   - 目标文件同名覆盖与否由调用方决定（Rust 侧保证不覆盖）

const sharp = require('sharp');
const path  = require('path');
const log   = require('../lib/logger');
const { exportSem }      = require('../lib/concurrency');
const { checkExportReq } = require('../lib/validate');

const DEFAULT_QUALITY = 90;

async function handle(req) {
  // ── 参数校验 ──────────────────────────────────────────
  const err = checkExportReq(req);
  if (err) return err;

  const { src, dest, format, quality = DEFAULT_QUALITY, maxDim } = req;
  const t0 = Date.now();

  return exportSem.run(async () => {
    try {
      // ── Step 1: 解码 + EXIF 转正（与 decode/thumbnail 同一路径）──
      let pipeline = sharp(src, {
        failOnError:      false,
        limitInputPixels: false,
        sequentialRead:   true,
      }).rotate();

      // ── Step 2: 可选等比缩放（最长边 ≤ maxDim，不放大）──
      if (typeof maxDim === 'number' && maxDim > 0) {
        pipeline = pipeline.resize(maxDim, maxDim, {
          fit:                'inside',
          withoutEnlargement: true,
        });
      }

      // ── Step 3: 格式编码 ────────────────────────────────
      const formatted = format === 'png'
        ? pipeline.png({ compressionLevel: 6 })          // PNG 无损
        : pipeline.jpeg({
            quality,
            mozjpeg:           false,
            chromaSubsampling: '4:2:0',
          });

      // ── Step 4: 落盘 ───────────────────────────────────
      const out = await formatted.toFile(dest);

      log.debug('Export done', {
        file:    path.basename(src),
        dest:    path.basename(dest),
        w:       out.width,
        h:       out.height,
        format,
        bytes:   out.size,
        elapsed: `${Date.now() - t0}ms`,
      });

      return {
        ok:     true,
        path:   dest,
        width:  out.width,
        height: out.height,
      };

    } catch (e) {
      log.error('Export failed', { file: path.basename(src), error: e.message });
      return { ok: false, error: `export: ${e.message || String(e)}` };
    }
  });
}

module.exports = { handle };
