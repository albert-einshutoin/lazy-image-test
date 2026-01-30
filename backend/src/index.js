import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { ImageEngine } from '@alberteinshutoin/lazy-image'; // ✅ 修正
import ssimModule from 'ssim.js';
const ssim = ssimModule.ssim || ssimModule.default || ssimModule;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// lazy-imageのバージョンを取得する関数
function getLazyImageVersion() {
  // 方法1: require.resolve()を使ってパッケージのパスを取得（最も確実）
  try {
    const packagePath = require.resolve('@alberteinshutoin/lazy-image/package.json');
    if (fs.existsSync(packagePath)) {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      const version = packageJson.version || 'unknown';
      console.log(`[getLazyImageVersion] ✅ Found version ${version} via require.resolve: ${packagePath}`);
      return version;
    }
  } catch (error) {
    console.warn(`[getLazyImageVersion] ⚠️ require.resolve() failed: ${error.message}`);
  }

  // 方法2: package.jsonから直接読み取る（複数のパスを試す）
  const possiblePaths = [
    path.join(__dirname, '../node_modules/@alberteinshutoin/lazy-image/package.json'), // Docker: /app/src -> /app/node_modules
    path.join(__dirname, '../../node_modules/@alberteinshutoin/lazy-image/package.json'), // ローカル開発環境
    path.join(process.cwd(), 'node_modules/@alberteinshutoin/lazy-image/package.json'), // ワーキングディレクトリ基準
    path.resolve(process.cwd(), 'node_modules/@alberteinshutoin/lazy-image/package.json'), // 絶対パス
  ];

  for (const packagePath of possiblePaths) {
    try {
      if (fs.existsSync(packagePath)) {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
        const version = packageJson.version || 'unknown';
        console.log(`[getLazyImageVersion] ✅ Found version ${version} at: ${packagePath}`);
        return version;
      }
    } catch (error) {
      // 次のパスを試す
      console.warn(`[getLazyImageVersion] ⚠️ Failed to read ${packagePath}: ${error.message}`);
      continue;
    }
  }

  // 方法3: import.meta.resolve()を試す（Node.js 20.6.0+）
  try {
    // import.meta.resolve()は実験的機能だが、Node.js 20.6.0+で利用可能
    if (typeof import.meta.resolve === 'function') {
      const resolvedPath = import.meta.resolve('@alberteinshutoin/lazy-image/package.json');
      const packagePath = fileURLToPath(resolvedPath);
      if (fs.existsSync(packagePath)) {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
        const version = packageJson.version || 'unknown';
        console.log(`[getLazyImageVersion] ✅ Found version ${version} via import.meta.resolve: ${packagePath}`);
        return version;
      }
    }
  } catch (error) {
    // import.meta.resolve()が利用できない、または失敗
    console.warn(`[getLazyImageVersion] import.meta.resolve() failed: ${error.message}`);
  }

  // デバッグ情報を出力
  console.error('[getLazyImageVersion] ❌ Failed to find package.json. Tried paths:');
  possiblePaths.forEach(p => console.error(`  - ${p} (exists: ${fs.existsSync(p)})`));
  console.error(`[getLazyImageVersion] __dirname: ${__dirname}`);
  console.error(`[getLazyImageVersion] process.cwd(): ${process.cwd()}`);
  
  // フォールバック: package.jsonから直接読み取る
  try {
    const backendPackageJson = path.join(__dirname, '../package.json');
    if (fs.existsSync(backendPackageJson)) {
      const packageJson = JSON.parse(fs.readFileSync(backendPackageJson, 'utf-8'));
      const lazyImageDep = packageJson.dependencies?.['@alberteinshutoin/lazy-image'];
      if (lazyImageDep) {
        console.warn(`[getLazyImageVersion] ⚠️ Using version from package.json dependency: ${lazyImageDep}`);
        // バージョン範囲から実際のバージョンを抽出（例: "^0.9.0" -> "0.9.0"）
        const versionMatch = lazyImageDep.match(/(\d+\.\d+\.\d+)/);
        if (versionMatch) {
          return versionMatch[1];
        }
        return lazyImageDep.replace(/[\^~]/, '');
      }
    }
  } catch (error) {
    console.error(`[getLazyImageVersion] Failed to read backend package.json: ${error.message}`);
  }
  
  return 'unknown';
}

const app = express();
const PORT = process.env.PORT || 4000;

// CORS設定
app.use(cors());
app.use(express.json({ limit: '10gb' }));
app.use(express.urlencoded({ limit: '10gb', extended: true }));

// 静的ファイル配信
app.use('/output', express.static(path.join(__dirname, '../output')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Multer設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10GB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WebP, AVIF are allowed.'));
    }
  }
});

// 画質評価用ヘルパー関数
async function getRawData(imagePathOrBuffer, width, height) {
  let pipeline = sharp(imagePathOrBuffer);
  // メトリクス計算のためにサイズを強制的に合わせる（比較対象と同じ次元にする）
  if (width && height) {
    pipeline = pipeline.resize(width, height, { fit: 'fill' });
  }
  
  // SSIM/PSNR計算用にグレースケールデータを取得
  // ssim.jsはグレースケール画像を期待するため、グレースケールに変換
  const { data, info } = await pipeline
    .removeAlpha()
    .greyscale() // グレースケールに変換
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  // ssim.jsはUint8ClampedArrayを期待するので変換
  // dataはBuffer (Uint8Array)なので、Uint8ClampedArrayに変換
  const clampedData = new Uint8ClampedArray(data);
    
  return { data: clampedData, width: info.width, height: info.height };
}

function calculatePSNR(refData, targetData) {
  if (!refData || !targetData || refData.length !== targetData.length) {
    return 0;
  }
  
  let mse = 0;
  const length = Math.min(refData.length, targetData.length);
  for (let i = 0; i < length; i++) {
    const error = refData[i] - targetData[i];
    mse += error * error;
  }
  
  mse /= length;
  
  if (mse === 0) return Infinity; // 完全一致
  // 最大信号値は255（8bit）
  return 20 * Math.log10(255 / Math.sqrt(mse));
}

async function calculateMetrics(refRaw, targetPath) {
  try {
    // ターゲット画像をRawデータに変換（サイズは参照画像に合わせる）
    const targetRaw = await getRawData(targetPath, refRaw.width, refRaw.height);
    
    // PSNR計算（Uint8ClampedArrayを通常の配列として扱う）
    const refArray = Array.from(refRaw.data);
    const targetArray = Array.from(targetRaw.data);
    const psnr = calculatePSNR(refArray, targetArray);
    
    // SSIM計算
    // ssim.jsは { data: Uint8ClampedArray, width, height } を受け取る
    // オプションなしで実行（デフォルトのWeberアルゴリズムを使用）
    const ssimResult = ssim(
      { data: refRaw.data, width: refRaw.width, height: refRaw.height },
      { data: targetRaw.data, width: targetRaw.width, height: targetRaw.height }
    );

    const result = {
      psnr: psnr === Infinity ? 100 : parseFloat(psnr.toFixed(2)), // Infinityの場合は便宜上100dB
      ssim: parseFloat(ssimResult.mssim.toFixed(4))
    };
    
    console.log(`[calculateMetrics] Calculated: SSIM=${result.ssim}, PSNR=${result.psnr}dB`);
    return result;
  } catch (e) {
    console.error('Metrics calculation failed:', e);
    console.error('Stack:', e.stack);
    return { psnr: 0, ssim: 0 };
  }
}

// ベンチマーク実行
async function runBenchmark(inputPath, sessionId) {
  const outputDir = path.join(__dirname, '../output', sessionId);
  fs.mkdirSync(outputDir, { recursive: true });

  const originalStats = fs.statSync(inputPath);
  const originalMetadata = await sharp(inputPath).metadata();

  // 参照データの準備（画質評価用）
  // 注意: 大きすぎる画像はメモリ不足になる可能性があるため、一定サイズ以下の場合のみ計算するなどの制限が必要だが、
  // ここではデモ用にそのまま処理する。実運用ではリサイズやクロップが必要。
  let zeroCopyRef = null;
  let resizeRef = null;
  
  try {
    // Zero-Copy用参照データ（元画像そのまま）
    if (originalStats.size < 50 * 1024 * 1024) { // 50MB以下ならメモリに乗せる
       zeroCopyRef = await getRawData(inputPath);
       console.log(`[Metrics] Zero-Copy reference prepared: ${zeroCopyRef.width}x${zeroCopyRef.height}, data length: ${zeroCopyRef.data.length}`);
    } else {
      console.log(`[Metrics] Skipping Zero-Copy reference (file too large: ${(originalStats.size / 1024 / 1024).toFixed(2)}MB)`);
    }
    
    // Resize用参照データ（Sharpで最高品質でリサイズしたものを正解とする）
    resizeRef = await getRawData(inputPath, 800, 600);
    console.log(`[Metrics] Resize reference prepared: ${resizeRef.width}x${resizeRef.height}, data length: ${resizeRef.data.length}`);
  } catch (e) {
    console.warn('Failed to prepare reference data for metrics:', e);
    console.warn('Stack:', e.stack);
  }

  const results = {
    original: {
      filename: path.basename(inputPath),
      size: originalStats.size,
      width: originalMetadata.width,
      height: originalMetadata.height,
      format: originalMetadata.format
    },
    versions: {
      lazyImage: getLazyImageVersion(),
      sharp: sharp.versions?.sharp || 'latest'
    },
    categories: []
  };

  // Category 1: Zero-Copy conversion (no resize) - lazy-image's strength
  const zeroCopyResults = await runZeroCopyTests(inputPath, outputDir, sessionId, zeroCopyRef);
  results.categories.push({
    name: 'Zero-Copy Conversion (No Resize)',
    description: 'lazy-image\'s strength: Direct conversion without copying pixel buffers',
    highlight: 'lazyImage',
    results: zeroCopyResults
  });

  // Category 2: Resize + Conversion - Common features
  const resizeResults = await runResizeTests(inputPath, outputDir, sessionId, originalMetadata, resizeRef);
  results.categories.push({
    name: 'Resize + Format Conversion',
    description: 'Common features: Resize to 800x600, then convert to each format',
    highlight: null,
    results: resizeResults
  });

  // Category 3: Advanced operations - sharp's strength
  // Advanced operations change the image content significantly (crop, blur, grayscale), so SSIM/PSNR 
  // against the original is not useful. We skip metrics for this category.
  const advancedResults = await runAdvancedTests(inputPath, outputDir, sessionId);
  results.categories.push({
    name: 'Advanced Image Operations',
    description: 'sharp\'s strength: Advanced operations not supported by lazy-image',
    highlight: 'sharp',
    results: advancedResults
  });

  return results;
}

// Zero-Copy conversion test (no resize) - Optimized for Zero-Copy
async function runZeroCopyTests(inputPath, outputDir, sessionId, refRaw) {
  const results = [];

  // ✅ Read from file path directly (better memory efficiency)
  // ✅ No resize, so Zero-Copy's strength is maximized

  // WebP conversion (no resize)
  results.push(await runSingleTest({
    operation: 'WebP Conversion (No Resize)',
    inputPath,
    outputDir,
    sessionId,
    refRaw,
    lazyImageFn: async (img, outputPath) => {
      // ✅ Use fromPath() and toFile() (maximize memory efficiency)
      await img.toFile(outputPath, 'webp', 80);
    },
    sharpFn: async (inputPath, outputPath) => {
      // ✅ File-based for fair comparison
      await sharp(inputPath).webp({ quality: 80 }).toFile(outputPath);
    },
    outputExt: '.webp',
    lazyImageSupported: true,
    sharpSupported: true
  }));

  // AVIF conversion (no resize) - lazy-image's biggest strength
  results.push(await runSingleTest({
    operation: 'AVIF Conversion (No Resize)',
    inputPath,
    outputDir,
    sessionId,
    refRaw,
    lazyImageFn: async (img, outputPath) => {
      // ✅ AVIF is lazy-image's biggest strength (speed and file size)
      await img.toFile(outputPath, 'avif', 60);
    },
    sharpFn: async (inputPath, outputPath) => {
      // ✅ File-based for fair comparison
      await sharp(inputPath).avif({ quality: 60 }).toFile(outputPath);
    },
    outputExt: '.avif',
    lazyImageSupported: true,
    sharpSupported: true
  }));

  // JPEG compression (no resize)
  results.push(await runSingleTest({
    operation: 'JPEG Compression (No Resize)',
    inputPath,
    outputDir,
    sessionId,
    refRaw,
    lazyImageFn: async (img, outputPath) => {
      // ✅ Leverage mozjpeg's strength
      await img.toFile(outputPath, 'jpeg', 80);
    },
    sharpFn: async (inputPath, outputPath) => {
      // ✅ File-based for fair comparison
      await sharp(inputPath).jpeg({ quality: 80 }).toFile(outputPath);
    },
    outputExt: '.jpg',
    lazyImageSupported: true,
    sharpSupported: true
  }));

  return results;
}

// Resize + conversion test - Optimized
async function runResizeTests(inputPath, outputDir, sessionId, metadata, refRaw) {
  const results = [];

  const targetWidth = 800;
  const targetHeight = 600;

  // Calculate aspect ratio
  const originalAspectRatio = metadata.width / metadata.height;
  const targetAspectRatio = targetWidth / targetHeight;

  // Resize + WebP
  results.push(await runSingleTest({
    operation: 'Resize + WebP',
    inputPath,
    outputDir,
    sessionId,
    refRaw,
    lazyImageFn: async (img, outputPath) => {
      // ✅ Maintain aspect ratio (specify width only)
      // ✅ Use fromPath() and toFile()
      await img.resize(targetWidth, null).toFile(outputPath, 'webp', 80);
    },
    sharpFn: async (inputPath, outputPath) => {
      // ✅ File-based for fair comparison
      await sharp(inputPath)
        .resize(targetWidth, targetHeight, { fit: 'inside' })
        .webp({ quality: 80 })
        .toFile(outputPath);
    },
    outputExt: '_resize.webp',
    lazyImageSupported: true,
    sharpSupported: true
  }));

  // Resize + AVIF - lazy-image's strength
  results.push(await runSingleTest({
    operation: 'Resize + AVIF',
    inputPath,
    outputDir,
    sessionId,
    refRaw,
    lazyImageFn: async (img, outputPath) => {
      // ✅ AVIF is lazy-image's biggest strength
      await img.resize(targetWidth, null).toFile(outputPath, 'avif', 60);
    },
    sharpFn: async (inputPath, outputPath) => {
      // ✅ File-based for fair comparison
      await sharp(inputPath)
        .resize(targetWidth, targetHeight, { fit: 'inside' })
        .avif({ quality: 60 })
        .toFile(outputPath);
    },
    outputExt: '_resize.avif',
    lazyImageSupported: true,
    sharpSupported: true
  }));

  // Resize + JPEG - mozjpeg's strength
  results.push(await runSingleTest({
    operation: 'Resize + JPEG',
    inputPath,
    outputDir,
    sessionId,
    refRaw,
    lazyImageFn: async (img, outputPath) => {
      // ✅ mozjpeg's strength (file size optimization)
      await img.resize(targetWidth, null).toFile(outputPath, 'jpeg', 80);
    },
    sharpFn: async (inputPath, outputPath) => {
      // ✅ File-based for fair comparison
      await sharp(inputPath)
        .resize(targetWidth, targetHeight, { fit: 'inside' })
        .jpeg({ quality: 80 })
        .toFile(outputPath);
    },
    outputExt: '_resize.jpg',
    lazyImageSupported: true,
    sharpSupported: true
  }));

  return results;
}

// Advanced operations test (sharp only)
async function runAdvancedTests(inputPath, outputDir, sessionId) {
  const results = [];

  // PNG compression
  results.push(await runSingleTest({
    operation: 'PNG Compression',
    inputPath,
    outputDir,
    sessionId,
    lazyImageFn: null,
    sharpFn: async (inputPath, outputPath) => {
      // ✅ File-based for fair comparison
      await sharp(inputPath).png({ compressionLevel: 9 }).toFile(outputPath);
    },
    outputExt: '.png',
    lazyImageSupported: false,
    sharpSupported: true
  }));

  // Rotation
  results.push(await runSingleTest({
    operation: '90° Rotation',
    inputPath,
    outputDir,
    sessionId,
    lazyImageFn: null,
    sharpFn: async (inputPath, outputPath) => {
      // ✅ File-based for fair comparison
      await sharp(inputPath).rotate(90).jpeg({ quality: 80 }).toFile(outputPath);
    },
    outputExt: '_rotate.jpg',
    lazyImageSupported: false,
    sharpSupported: true
  }));

  // Crop
  results.push(await runSingleTest({
    operation: 'Crop (Center 50%)',
    inputPath,
    outputDir,
    sessionId,
    lazyImageFn: null,
    sharpFn: async (inputPath, outputPath) => {
      // ✅ File-based for fair comparison
      const metadata = await sharp(inputPath).metadata();
      const cropWidth = Math.floor(metadata.width * 0.5);
      const cropHeight = Math.floor(metadata.height * 0.5);
      const left = Math.floor((metadata.width - cropWidth) / 2);
      const top = Math.floor((metadata.height - cropHeight) / 2);
      await sharp(inputPath)
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .jpeg({ quality: 80 })
        .toFile(outputPath);
    },
    outputExt: '_crop.jpg',
    lazyImageSupported: false,
    sharpSupported: true
  }));

  // Blur
  results.push(await runSingleTest({
    operation: 'Blur (sigma: 5)',
    inputPath,
    outputDir,
    sessionId,
    lazyImageFn: null,
    sharpFn: async (inputPath, outputPath) => {
      // ✅ File-based for fair comparison
      await sharp(inputPath).blur(5).jpeg({ quality: 80 }).toFile(outputPath);
    },
    outputExt: '_blur.jpg',
    lazyImageSupported: false,
    sharpSupported: true
  }));

  // Grayscale
  results.push(await runSingleTest({
    operation: 'Grayscale',
    inputPath,
    outputDir,
    sessionId,
    lazyImageFn: null,
    sharpFn: async (inputPath, outputPath) => {
      // ✅ File-based for fair comparison
      await sharp(inputPath).grayscale().jpeg({ quality: 80 }).toFile(outputPath);
    },
    outputExt: '_gray.jpg',
    lazyImageSupported: false,
    sharpSupported: true
  }));

  return results;
}

// Individual test execution - Optimized and Fair
async function runSingleTest(config) {
  const {
    operation,
    inputPath,
    outputDir,
    sessionId,
    refRaw, // 参照用Rawデータ（これがある場合のみメトリクス計算）
    lazyImageFn,
    sharpFn,
    outputExt,
    lazyImageSupported,
    sharpSupported
  } = config;

  const result = {
    operation,
    lazyImage: { supported: lazyImageSupported },
    sharp: { supported: sharpSupported }
  };

  // lazy-image test - Optimized with fair comparison
  if (lazyImageSupported && lazyImageFn) {
    try {
      // ✅ Use fromPath() (maximize memory efficiency)
      // Handle AVIF file case
      let actualInputPath = inputPath;
      let avifConversionTime = 0;
      const metadata = await sharp(inputPath).metadata();

      if (metadata.format === 'avif') {
        console.log(`[${operation}] Converting AVIF to JPEG for lazy-image compatibility...`);
        const conversionStart = performance.now();
        const tempJpegPath = path.join(outputDir, `temp_${uuidv4()}.jpg`);
        await sharp(inputPath).jpeg({ quality: 100 }).toFile(tempJpegPath);
        avifConversionTime = performance.now() - conversionStart;
        actualInputPath = tempJpegPath;
        console.log(`[${operation}] AVIF conversion time: ${Math.round(avifConversionTime)}ms`);
      }

      const outputFilename = `lazyimage_${operation.replace(/[^a-zA-Z0-9]/g, '_')}${outputExt}`;
      const outputPath = path.join(outputDir, outputFilename);

      // メモリ使用量測定（処理中のピークを測定）
      const memBefore = process.memoryUsage();
      if (global.gc) global.gc();
      const initialHeapUsed = process.memoryUsage().heapUsed;
      
      let peakMemory = initialHeapUsed;
      const memoryMonitor = setInterval(() => {
        const current = process.memoryUsage().heapUsed;
        if (current > peakMemory) {
          peakMemory = current;
        }
      }, 10); // 10msごとにチェック
      
      const img = ImageEngine.fromPath(actualInputPath); // ✅ Use fromPath()
      const startTime = performance.now();
      await lazyImageFn(img, outputPath); // outputPathを渡す
      const endTime = performance.now();
      
      clearInterval(memoryMonitor);
      // 処理直後のメモリも確認
      const memAfter = process.memoryUsage();
      peakMemory = Math.max(peakMemory, memAfter.heapUsed);
      const memoryUsed = peakMemory - initialHeapUsed;

      // サイズ取得（時間測定外）
      const outputBuffer = fs.readFileSync(outputPath);

      // メトリクス計算
      let metrics = {};
      if (refRaw) {
        console.log(`[${operation}] Calculating metrics for lazy-image (ref: ${refRaw.width}x${refRaw.height})`);
        metrics = await calculateMetrics(refRaw, outputPath);
        console.log(`[${operation}] lazy-image metrics: SSIM=${metrics.ssim}, PSNR=${metrics.psnr}dB`);
      } else {
        console.log(`[${operation}] Skipping metrics for lazy-image (no reference data)`);
      }

      result.lazyImage = {
        supported: true,
        time: Math.round(endTime - startTime),
        totalTime: Math.round(endTime - startTime) + (avifConversionTime > 0 ? Math.round(avifConversionTime) : 0),
        avifConversionTime: avifConversionTime > 0 ? Math.round(avifConversionTime) : null,
        size: outputBuffer.length,
        // メモリ使用量（MB単位、処理中のピークメモリ - 初期メモリ）
        // 注意: ガベージコレクションの影響で負の値になる場合があるが、その場合は0として扱う
        memoryUsed: Math.max(0, Math.round(memoryUsed / 1024 / 1024 * 100) / 100),
        url: `/output/${sessionId}/${outputFilename}`,
        ...metrics
      };

      // Clean up temporary file
      if (actualInputPath !== inputPath && fs.existsSync(actualInputPath)) {
        fs.unlinkSync(actualInputPath);
      }
    } catch (error) {
      console.error(`[${operation}] lazy-image error:`, error.message);
      console.error(`[${operation}] Stack:`, error.stack);
      result.lazyImage = {
        supported: true,
        error: error.message,
        time: null,
        size: null
      };
    }
  }

  // sharp test - File-based for fair comparison
  if (sharpSupported && sharpFn) {
    try {
      const outputFilename = `sharp_${operation.replace(/[^a-zA-Z0-9]/g, '_')}${outputExt}`;
      const outputPath = path.join(outputDir, outputFilename);

      // メモリ使用量測定（処理中のピークを測定）
      const memBefore = process.memoryUsage();
      if (global.gc) global.gc();
      const initialHeapUsed = process.memoryUsage().heapUsed;
      
      let peakMemory = initialHeapUsed;
      const memoryMonitor = setInterval(() => {
        const current = process.memoryUsage().heapUsed;
        if (current > peakMemory) {
          peakMemory = current;
        }
      }, 10); // 10msごとにチェック

      // ファイルベースで処理（公平な比較のため）
      const startTime = performance.now();
      await sharpFn(inputPath, outputPath); // inputPathとoutputPathを渡す
      const endTime = performance.now();

      clearInterval(memoryMonitor);
      // 処理直後のメモリも確認
      const memAfter = process.memoryUsage();
      peakMemory = Math.max(peakMemory, memAfter.heapUsed);
      const memoryUsed = peakMemory - initialHeapUsed;

      // サイズ取得（時間測定外）
      const outputBuffer = fs.readFileSync(outputPath);

      // メトリクス計算
      let metrics = {};
      if (refRaw) {
        console.log(`[${operation}] Calculating metrics for sharp (ref: ${refRaw.width}x${refRaw.height})`);
        metrics = await calculateMetrics(refRaw, outputPath);
        console.log(`[${operation}] sharp metrics: SSIM=${metrics.ssim}, PSNR=${metrics.psnr}dB`);
      } else {
        console.log(`[${operation}] Skipping metrics for sharp (no reference data)`);
      }

      result.sharp = {
        supported: true,
        time: Math.round(endTime - startTime),
        size: outputBuffer.length,
        // メモリ使用量（MB単位、処理中のピークメモリ - 初期メモリ）
        // 注意: ガベージコレクションの影響で負の値になる場合があるが、その場合は0として扱う
        memoryUsed: Math.max(0, Math.round(memoryUsed / 1024 / 1024 * 100) / 100),
        url: `/output/${sessionId}/${outputFilename}`,
        ...metrics
      };
    } catch (error) {
      console.error(`[${operation}] sharp error:`, error.message);
      result.sharp = {
        supported: true,
        error: error.message,
        time: null,
        size: null
      };
    }
  }

  return result;
}

// ベンチマークエンドポイント
app.post('/api/benchmark', (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      // multerのエラーを処理
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ 
          error: `File size too large. Maximum size is 10GB.` 
        });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Too many files. Only one file is allowed.' });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Unexpected file field.' });
      }
      return res.status(400).json({ error: err.message || 'File upload error' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const sessionId = uuidv4();
    const inputPath = req.file.path;
    const fileSize = req.file.size;

    console.log(`Starting benchmark for: ${req.file.originalname} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
    const results = await runBenchmark(inputPath, sessionId);
    console.log('Benchmark completed');

    res.json(results);
  } catch (error) {
    console.error('Benchmark error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ヘルスチェック
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// バージョン情報
app.get('/api/versions', (req, res) => {
  res.json({
    lazyImage: getLazyImageVersion(),
    sharp: sharp.versions?.sharp || 'latest',
    node: process.version
  });
});

// グローバルエラーハンドラー（すべてのルートの後に配置）
app.use((err, req, res, next) => {
  if (err) {
    console.error('Global error handler:', err);
    
    // multerのエラーを処理
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ 
        error: `File size too large. Maximum size is 10GB.` 
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files. Only one file is allowed.' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected file field.' });
    }
    
    // その他のエラー
    res.status(err.status || 500).json({ 
      error: err.message || 'Internal server error' 
    });
  } else {
    next();
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});