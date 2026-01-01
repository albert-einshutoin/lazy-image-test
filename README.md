<img width="1353" height="964" alt="スクリーンショット 2025-12-31 15 55 47 1" src="https://github.com/user-attachments/assets/5e336131-7d49-4913-ae5d-0c3f825505e1" />


# lazy-image performance test (sharp vs lazy-image)

## Overview

This repository provides a test environment to compare image-processing performance between `sharp` and `@alberteinshutoin/lazy-image`. It runs via Docker and allows you to measure processing time and behavior under the same conditions.

## Targets

- sharp
- @alberteinshutoin/lazy-image

## lazy-image links

- GitHub: https://github.com/albert-einshutoin/lazy-image
- npm: https://www.npmjs.com/package/@alberteinshutoin/lazy-image

## Usage

### 1) Install dependencies

```bash
cd backend
npm install
```

### 2) Run with Docker

```bash
docker-compose up --build
```

### 3) Run tests

Please refer to the scripts and code in the project for the detailed test flow.

## Notes

- Benchmark conditions are defined in the code.
- Results vary by runtime environment (CPU/memory/disk).

## Test code (detailed overview)

- The benchmark logic is implemented in `backend/src/index.js` and is triggered by `POST /api/benchmark` with a single uploaded image.
- Uploads are stored under `backend/uploads` via Multer with a 10GB limit and MIME checks for JPEG/PNG/WebP/AVIF.
- A unique session ID is created per run and results are written under `backend/output/<sessionId>`.
- The benchmark is organized into three categories:
- Zero-Copy Conversion (No Resize): WebP/AVIF/JPEG conversions without resizing, intended to showcase lazy-image’s direct path-to-file workflow.
- Resize + Format Conversion: resize to 800x600 (fit inside) and then convert to WebP/AVIF/JPEG.
- Advanced Image Operations (sharp-only): PNG compression, rotation, center crop, blur, and grayscale.
- Each operation is executed through a shared runner that:
- measures elapsed time via `performance.now()`,
- captures output size (buffer length),
- writes the output file, and
- returns a JSON payload with `time`, `size`, `supported`, and `url`.
- For AVIF input, lazy-image runs with a temporary JPEG conversion for compatibility and cleans it up afterward.
- Version info is exposed via `GET /api/versions`, and a health check is available at `GET /api/health`.

---

# lazy-image パフォーマンステスト（sharp vs lazy-image）

## 概要

このリポジトリは、`sharp` と `@alberteinshutoin/lazy-image` の画像処理パフォーマンスを比較するためのテスト環境です。Docker 構成で実行でき、同一条件での処理時間・挙動を確認できます。

## 対象

- sharp
- @alberteinshutoin/lazy-image

## lazy-image リンク

- GitHub: https://github.com/albert-einshutoin/lazy-image
- npm: https://www.npmjs.com/package/@alberteinshutoin/lazy-image

## 使い方

### 1) 依存関係の準備

```bash
cd backend
npm install
```

### 2) Docker で実行

```bash
docker-compose up --build
```

### 3) テストの実行

詳細な手順はプロジェクト内のスクリプトやコードを参照してください。

## 補足

- ベンチマーク条件はコード内で定義されています。
- 実行環境（CPU/メモリ/ディスク）により結果が変動します。

## テストコードの説明（詳細）

- ベンチマーク処理は `backend/src/index.js` に実装されており、`POST /api/benchmark` に1枚の画像をアップロードすることで実行されます。
- アップロードは Multer で `backend/uploads` に保存され、10GB制限と JPEG/PNG/WebP/AVIF の MIME チェックがあります。
- 実行ごとにセッションIDを生成し、出力は `backend/output/<sessionId>` に保存されます。
- ベンチマークは3カテゴリに分かれています。
- ゼロコピー変換（リサイズなし）: WebP/AVIF/JPEG への変換。lazy-image のパス→ファイル処理を想定。
- リサイズ＋変換: 800x600 の内接リサイズ後に WebP/AVIF/JPEG へ変換。
- 高度な処理（sharpのみ）: PNG圧縮、回転、中央クロップ、ぼかし、グレースケール。
- すべての処理は共通の実行関数で行われ、`performance.now()` による時間計測、出力サイズの記録、ファイル出力、`time/size/supported/url` を含むJSON結果の生成を行います。
- AVIF 入力の場合、lazy-image は互換性のため一時的に JPEG に変換して処理し、完了後に削除します。
- バージョン情報は `GET /api/versions`、ヘルスチェックは `GET /api/health` で確認できます。
