import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { ImageEngine } from '@alberteinshutoin/lazy-image'; // ✅ 修正

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// ベンチマーク実行
async function runBenchmark(inputPath, sessionId) {
  const outputDir = path.join(__dirname, '../output', sessionId);
  fs.mkdirSync(outputDir, { recursive: true });

  const originalStats = fs.statSync(inputPath);
  const originalMetadata = await sharp(inputPath).metadata();

  const results = {
    original: {
      filename: path.basename(inputPath),
      size: originalStats.size,
      width: originalMetadata.width,
      height: originalMetadata.height,
      format: originalMetadata.format
    },
    versions: {
      lazyImage: '0.8.x',
      sharp: sharp.versions?.sharp || 'latest'
    },
    categories: []
  };

  // Category 1: Zero-Copy conversion (no resize) - lazy-image's strength
  const zeroCopyResults = await runZeroCopyTests(inputPath, outputDir, sessionId);
  results.categories.push({
    name: 'Zero-Copy Conversion (No Resize)',
    description: 'lazy-image\'s strength: Direct conversion without copying pixel buffers',
    highlight: 'lazyImage',
    results: zeroCopyResults
  });

  // Category 2: Resize + Conversion - Common features
  const resizeResults = await runResizeTests(inputPath, outputDir, sessionId, originalMetadata);
  results.categories.push({
    name: 'Resize + Format Conversion',
    description: 'Common features: Resize to 800x600, then convert to each format',
    highlight: null,
    results: resizeResults
  });

  // Category 3: Advanced operations - sharp's strength
  const advancedResults = await runAdvancedTests(inputPath, outputDir, sessionId);
  results.categories.push({
    name: 'Advanced Image Operations',
    description: 'sharp\'s strength: Advanced operations not supported by lazy-image',
    highlight: 'sharp',
    results: advancedResults
  });

  return results;
}

// Zero-Copy変換テスト (リサイズなし)
async function runZeroCopyTests(inputPath, outputDir, sessionId) {
  const results = [];
  const inputBuffer = fs.readFileSync(inputPath);

  // WebP conversion (no resize)
  results.push(await runSingleTest({
    operation: 'WebP Conversion (No Resize)',
    inputPath,
    inputBuffer,
    outputDir,
    sessionId,
    lazyImageFn: async (img) => {
      return await img.toBuffer('webp', 80); // ✅ 修正
    },
    sharpFn: async (s) => {
      return await s.webp({ quality: 80 }).toBuffer();
    },
    outputExt: '.webp',
    lazyImageSupported: true,
    sharpSupported: true
  }));

  // AVIF conversion (no resize)
  results.push(await runSingleTest({
    operation: 'AVIF Conversion (No Resize)',
    inputPath,
    inputBuffer,
    outputDir,
    sessionId,
    lazyImageFn: async (img) => {
      return await img.toBuffer('avif', 60); // ✅ 修正
    },
    sharpFn: async (s) => {
      return await s.avif({ quality: 60 }).toBuffer();
    },
    outputExt: '.avif',
    lazyImageSupported: true,
    sharpSupported: true
  }));

  // JPEG compression (no resize)
  results.push(await runSingleTest({
    operation: 'JPEG Compression (No Resize)',
    inputPath,
    inputBuffer,
    outputDir,
    sessionId,
    lazyImageFn: async (img) => {
      return await img.toBuffer('jpeg', 80); // ✅ 修正
    },
    sharpFn: async (s) => {
      return await s.jpeg({ quality: 80 }).toBuffer();
    },
    outputExt: '.jpg',
    lazyImageSupported: true,
    sharpSupported: true
  }));

  return results;
}

// リサイズ + 変換テスト
async function runResizeTests(inputPath, outputDir, sessionId, metadata) {
  const results = [];
  const inputBuffer = fs.readFileSync(inputPath);
  const targetWidth = 800;
  const targetHeight = 600;

  // Resize + WebP
  results.push(await runSingleTest({
    operation: 'Resize + WebP',
    inputPath,
    inputBuffer,
    outputDir,
    sessionId,
    lazyImageFn: async (img) => {
      return await img.resize(targetWidth, targetHeight).toBuffer('webp', 80); // ✅ 修正
    },
    sharpFn: async (s) => {
      return await s.resize(targetWidth, targetHeight, { fit: 'inside' }).webp({ quality: 80 }).toBuffer();
    },
    outputExt: '_resize.webp',
    lazyImageSupported: true,
    sharpSupported: true
  }));

  // Resize + AVIF
  results.push(await runSingleTest({
    operation: 'Resize + AVIF',
    inputPath,
    inputBuffer,
    outputDir,
    sessionId,
    lazyImageFn: async (img) => {
      return await img.resize(targetWidth, targetHeight).toBuffer('avif', 60); // ✅ 修正
    },
    sharpFn: async (s) => {
      return await s.resize(targetWidth, targetHeight, { fit: 'inside' }).avif({ quality: 60 }).toBuffer();
    },
    outputExt: '_resize.avif',
    lazyImageSupported: true,
    sharpSupported: true
  }));

  // Resize + JPEG
  results.push(await runSingleTest({
    operation: 'Resize + JPEG',
    inputPath,
    inputBuffer,
    outputDir,
    sessionId,
    lazyImageFn: async (img) => {
      return await img.resize(targetWidth, targetHeight).toBuffer('jpeg', 80); // ✅ 修正
    },
    sharpFn: async (s) => {
      return await s.resize(targetWidth, targetHeight, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
    },
    outputExt: '_resize.jpg',
    lazyImageSupported: true,
    sharpSupported: true
  }));

  return results;
}

// 高度な操作テスト (sharpのみ)
async function runAdvancedTests(inputPath, outputDir, sessionId) {
  const results = [];
  const inputBuffer = fs.readFileSync(inputPath);

  // PNG compression
  results.push(await runSingleTest({
    operation: 'PNG Compression',
    inputPath,
    inputBuffer,
    outputDir,
    sessionId,
    lazyImageFn: null,
    sharpFn: async (s) => {
      return await s.png({ compressionLevel: 9 }).toBuffer();
    },
    outputExt: '.png',
    lazyImageSupported: false,
    sharpSupported: true
  }));

  // Rotation
  results.push(await runSingleTest({
    operation: '90° Rotation',
    inputPath,
    inputBuffer,
    outputDir,
    sessionId,
    lazyImageFn: null,
    sharpFn: async (s) => {
      return await s.rotate(90).jpeg({ quality: 80 }).toBuffer();
    },
    outputExt: '_rotate.jpg',
    lazyImageSupported: false,
    sharpSupported: true
  }));

  // Crop
  results.push(await runSingleTest({
    operation: 'Crop (Center 50%)',
    inputPath,
    inputBuffer,
    outputDir,
    sessionId,
    lazyImageFn: null,
    sharpFn: async (s) => {
      const metadata = await sharp(inputBuffer).metadata();
      const cropWidth = Math.floor(metadata.width * 0.5);
      const cropHeight = Math.floor(metadata.height * 0.5);
      const left = Math.floor((metadata.width - cropWidth) / 2);
      const top = Math.floor((metadata.height - cropHeight) / 2);
      return await s.extract({ left, top, width: cropWidth, height: cropHeight }).jpeg({ quality: 80 }).toBuffer();
    },
    outputExt: '_crop.jpg',
    lazyImageSupported: false,
    sharpSupported: true
  }));

  // Blur
  results.push(await runSingleTest({
    operation: 'Blur (sigma: 5)',
    inputPath,
    inputBuffer,
    outputDir,
    sessionId,
    lazyImageFn: null,
    sharpFn: async (s) => {
      return await s.blur(5).jpeg({ quality: 80 }).toBuffer();
    },
    outputExt: '_blur.jpg',
    lazyImageSupported: false,
    sharpSupported: true
  }));

  // Grayscale
  results.push(await runSingleTest({
    operation: 'Grayscale',
    inputPath,
    inputBuffer,
    outputDir,
    sessionId,
    lazyImageFn: null,
    sharpFn: async (s) => {
      return await s.grayscale().jpeg({ quality: 80 }).toBuffer();
    },
    outputExt: '_gray.jpg',
    lazyImageSupported: false,
    sharpSupported: true
  }));

  return results;
}

// 個別テスト実行
async function runSingleTest(config) {
  const {
    operation,
    inputPath,
    inputBuffer,
    outputDir,
    sessionId,
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

  // lazy-image テスト
  if (lazyImageSupported && lazyImageFn) {
    try {
      // AVIFファイルの場合、sharpで一度JPEGに変換してからlazy-imageで処理
      let processedBuffer = inputBuffer;
      const metadata = await sharp(inputBuffer).metadata();
      if (metadata.format === 'avif') {
        console.log(`[${operation}] Converting AVIF to JPEG for lazy-image compatibility...`);
        processedBuffer = await sharp(inputBuffer).jpeg({ quality: 100 }).toBuffer();
      }

      const img = ImageEngine.from(processedBuffer);
      const startTime = performance.now();
      const outputBuffer = await lazyImageFn(img);
      const endTime = performance.now();

      const outputFilename = `lazyimage_${operation.replace(/[^a-zA-Z0-9]/g, '_')}${outputExt}`;
      const outputPath = path.join(outputDir, outputFilename);
      fs.writeFileSync(outputPath, outputBuffer);

      result.lazyImage = {
        supported: true,
        time: Math.round(endTime - startTime),
        size: outputBuffer.length,
        url: `/output/${sessionId}/${outputFilename}`
      };
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

  // sharp テスト
  if (sharpSupported && sharpFn) {
    try {
      const s = sharp(inputBuffer);
      const startTime = performance.now();
      const outputBuffer = await sharpFn(s);
      const endTime = performance.now();

      const outputFilename = `sharp_${operation.replace(/[^a-zA-Z0-9]/g, '_')}${outputExt}`;
      const outputPath = path.join(outputDir, outputFilename);
      fs.writeFileSync(outputPath, outputBuffer);

      result.sharp = {
        supported: true,
        time: Math.round(endTime - startTime),
        size: outputBuffer.length,
        url: `/output/${sessionId}/${outputFilename}`
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
    lazyImage: '0.8.x',
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