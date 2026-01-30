import { useState, useCallback, useEffect } from 'react';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatMemory(memoryMB) {
  if (memoryMB == null || isNaN(memoryMB)) return '-';
  
  // 負の値の場合は0として扱う（ガベージコレクションの影響で処理後にメモリが減ることがある）
  // 実際のメモリ使用量は処理中のピークメモリで測定されているため、負の値は測定誤差
  const memory = Math.max(0, memoryMB);
  
  if (memory < 0.0001) {
    // 0.0001MB（約0.1KB）未満は「< 0.1 KB」と表示
    return '< 0.1 KB';
  } else if (memory < 0.1) {
    // 0.1MB未満はKBで表示（小数点以下1桁）
    const kb = memory * 1024;
    // 0.1KB未満の場合は最小0.1KBと表示
    return `${Math.max(0.1, kb).toFixed(1)} KB`;
  } else if (memory < 1024) {
    // 1GB未満はMBで表示
    return `${memory.toFixed(2)} MB`;
  } else {
    // 1GB以上はGBで表示
    const gb = memory / 1024;
    return `${gb.toFixed(2)} GB`;
  }
}

function getMaxTime(results) {
  let max = 0;
  results.forEach(r => {
    if (r.lazyImage?.time) max = Math.max(max, r.lazyImage.time);
    if (r.sharp?.time) max = Math.max(max, r.sharp.time);
  });
  return max || 100;
}

function getMaxSize(results) {
  let max = 0;
  results.forEach(r => {
    if (r.lazyImage?.size) max = Math.max(max, r.lazyImage.size);
    if (r.sharp?.size) max = Math.max(max, r.sharp.size);
  });
  return max || 1;
}

function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedPreview, setSelectedPreview] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [versions, setVersions] = useState({ lazyImage: 'unknown', sharp: 'unknown' });

  // バージョン情報を取得
  useEffect(() => {
    const fetchVersions = async () => {
      try {
        const response = await fetch('/api/versions');
        if (response.ok) {
          const data = await response.json();
          setVersions({
            lazyImage: data.lazyImage || 'unknown',
            sharp: data.sharp || 'unknown'
          });
        } else {
          console.warn('Failed to fetch versions:', response.status);
          setVersions({ lazyImage: 'unknown', sharp: 'unknown' });
        }
      } catch (err) {
        console.error('Error fetching versions:', err);
        setVersions({ lazyImage: 'unknown', sharp: 'unknown' });
      }
    };
    fetchVersions();
  }, []);

  const handleUpload = useCallback(async (file) => {
    // File size check (10GB limit)
    const maxSize = 10 * 1024 * 1024 * 1024; // 10GB
    if (file.size > maxSize) {
      setError(`File size too large. Maximum size is 10GB. Current file: ${formatBytes(file.size)}`);
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);
    setSelectedFile(file);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('image', file);

    try {
      // XMLHttpRequestを使用して進捗を取得
      const xhr = new XMLHttpRequest();
      
      const response = await new Promise((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentComplete = (e.loaded / e.total) * 100;
            setUploadProgress(percentComplete);
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText);
              resolve({ ok: true, json: () => Promise.resolve(data) });
            } catch (e) {
              reject(new Error('Invalid JSON response'));
            }
          } else {
            try {
              const errorData = JSON.parse(xhr.responseText);
              reject(new Error(errorData.error || `HTTP ${xhr.status}: ${xhr.statusText}`));
            } catch (e) {
              reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
            }
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Network error'));
        });

        xhr.addEventListener('abort', () => {
          reject(new Error('Upload aborted'));
        });

        xhr.open('POST', '/api/benchmark');
        xhr.send(formData);
      });

      if (!response.ok) {
        throw new Error('Benchmark failed');
      }

      const data = await response.json();
      setResults(data);
      setUploadProgress(100);
      
      // デフォルトで最初のカテゴリの最初の結果を選択
      if (data.categories?.[0]?.results?.[0]) {
        setSelectedPreview({
          category: 0,
          result: 0
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setSelectedFile(file);
      handleUpload(file);
    }
  }, [handleUpload]);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      handleUpload(file);
    } else {
      setSelectedFile(null);
    }
  }, [handleUpload]);

  const getSelectedImages = () => {
    if (!selectedPreview || !results) return null;
    const category = results.categories[selectedPreview.category];
    const result = category?.results[selectedPreview.result];
    return result;
  };

  return (
    <div className="app">
      <header className="header">
        <h1>lazy-image vs sharp</h1>
        <p>Real-time benchmark comparison of image processing libraries</p>
        <div className="version-badges">
          <span className="badge rust">lazy-image {results?.versions?.lazyImage || versions.lazyImage}</span>
          <span className="badge sharp">sharp {results?.versions?.sharp || versions.sharp}</span>
        </div>
      </header>

      <div
        className={`uploader ${dragOver ? 'dragover' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-input').click()}
      >
        <div className="uploader-icon">📸</div>
        <h3>Drag & Drop to upload image</h3>
        <p>or click to select file (JPEG, PNG, WebP, AVIF)</p>
        <p className="uploader-note">Supports up to 10GB</p>
        {selectedFile && (
          <div className="selected-file-info">
            <span className="file-name">{selectedFile.name}</span>
            <span className="file-size">{formatBytes(selectedFile.size)}</span>
            {selectedFile.size > 100 * 1024 * 1024 && (
              <span className="file-warning">⚠️ Large file. Processing may take some time.</span>
            )}
          </div>
        )}
        <input
          id="file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          onChange={handleFileChange}
        />
      </div>

      {loading && (
        <div className="loading">
          <div className="spinner"></div>
          <p>Running benchmark...</p>
          {uploadProgress > 0 && uploadProgress < 100 && (
            <div className="upload-progress">
              <div className="progress-bar-container">
                <div 
                  className="progress-bar" 
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
              <p className="progress-text">Uploading: {Math.round(uploadProgress)}%</p>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="error">
          <p>Error: {error}</p>
        </div>
      )}

      {results && (
        <>
          <div className="original-info">
            <div className="original-details">
              <h3>Original Image</h3>
              <div className="original-stats">
                <span>📁 {results.original.filename}</span>
                <span>📐 {results.original.width} × {results.original.height}</span>
                <span>💾 {formatBytes(results.original.size)}</span>
                <span>🖼️ {results.original.format?.toUpperCase()}</span>
              </div>
            </div>
          </div>

          <div className="results">
            {results.categories.map((category, catIdx) => (
              <CategorySection
                key={catIdx}
                category={category}
                catIdx={catIdx}
                selectedPreview={selectedPreview}
                setSelectedPreview={setSelectedPreview}
              />
            ))}
          </div>

          <PreviewSection
            results={results}
            selectedPreview={selectedPreview}
            setSelectedPreview={setSelectedPreview}
            getSelectedImages={getSelectedImages}
          />
        </>
      )}
    </div>
  );
}

function CategorySection({ category, catIdx, selectedPreview, setSelectedPreview }) {
  const maxTime = getMaxTime(category.results);
  const maxSize = getMaxSize(category.results);
  const headerClass = category.highlight === 'lazyImage' ? 'lazyImage' 
    : category.highlight === 'sharp' ? 'sharp' : 'neutral';

  return (
    <div className="category">
      <div className={`category-header ${headerClass}`}>
        <div>
          <h2>{category.name}</h2>
          <p>{category.description}</p>
        </div>
      </div>
      <div className="category-content">
        <table className="result-table">
          <thead>
            <tr>
              <th>Operation</th>
              <th>lazy-image</th>
              <th>sharp</th>
              <th className="th-quality">Quality (SSIM / PSNR)</th>
              <th>Time Comparison</th>
              <th>Size Comparison</th>
            </tr>
          </thead>
          <tbody>
            {category.results.map((result, resIdx) => {
              const lazyWinsTime = result.lazyImage?.supported && result.sharp?.supported 
                && result.lazyImage.time != null && result.sharp.time != null
                && result.lazyImage.time < result.sharp.time;
              const sharpWinsTime = result.lazyImage?.supported && result.sharp?.supported 
                && result.lazyImage.time != null && result.sharp.time != null
                && result.sharp.time < result.lazyImage.time;
              
              const lazyWinsSize = result.lazyImage?.supported && result.sharp?.supported 
                && result.lazyImage.size != null && result.sharp.size != null
                && result.lazyImage.size < result.sharp.size;
              const sharpWinsSize = result.lazyImage?.supported && result.sharp?.supported 
                && result.lazyImage.size != null && result.sharp.size != null
                && result.sharp.size < result.lazyImage.size;
              
              // Memory comparison (smaller is better)
              const lazyWinsMemory = result.lazyImage?.supported && result.sharp?.supported 
                && result.lazyImage.memoryUsed != null && result.sharp.memoryUsed != null
                && result.lazyImage.memoryUsed < result.sharp.memoryUsed;
              const sharpWinsMemory = result.lazyImage?.supported && result.sharp?.supported 
                && result.lazyImage.memoryUsed != null && result.sharp.memoryUsed != null
                && result.sharp.memoryUsed < result.lazyImage.memoryUsed;
              
              // Quality comparison (higher is better)
              // SSIM優先、差が0.001未満の場合はPSNRで比較
              const lazySSIM = result.lazyImage?.ssim || 0;
              const sharpSSIM = result.sharp?.ssim || 0;
              const lazyPSNR = result.lazyImage?.psnr || 0;
              const sharpPSNR = result.sharp?.psnr || 0;
              
              const ssimDiff = Math.abs(lazySSIM - sharpSSIM);
              let lazyWinsQuality = false;
              let sharpWinsQuality = false;
              
              if (ssimDiff > 0.001) {
                // SSIMの差が大きい場合はSSIMで判定
                lazyWinsQuality = lazySSIM > sharpSSIM;
                sharpWinsQuality = sharpSSIM > lazySSIM;
              } else if (lazyPSNR > 0 && sharpPSNR > 0) {
                // SSIMの差が小さい場合はPSNRで判定
                lazyWinsQuality = lazyPSNR > sharpPSNR;
                sharpWinsQuality = sharpPSNR > lazyPSNR;
              }

              const isSelected = selectedPreview?.category === catIdx && selectedPreview?.result === resIdx;

              return (
                <tr
                  key={resIdx}
                  onClick={() => setSelectedPreview({ category: catIdx, result: resIdx })}
                  style={{ cursor: 'pointer', background: isSelected ? 'rgba(88, 166, 255, 0.1)' : undefined }}
                >
                  <td className="operation-name">{result.operation}</td>
                  <td className={`result-cell ${lazyWinsTime || lazyWinsSize || lazyWinsMemory ? 'winner' : ''} ${!result.lazyImage?.supported ? 'not-supported' : ''}`}>
                    {result.lazyImage?.supported ? (
                      <>
                        <div className="time-value">
                          {result.lazyImage.time != null ? (
                            <>
                              <span>{result.lazyImage.time}ms</span>
                              {result.lazyImage.totalTime != null && result.lazyImage.totalTime !== result.lazyImage.time && (
                                <span className="total-time"> (Total: {result.lazyImage.totalTime}ms)</span>
                              )}
                              {result.lazyImage.avifConversionTime != null && (
                                <span className="avif-conversion-time" title="AVIF to JPEG conversion time">
                                  [AVIF conv: {result.lazyImage.avifConversionTime}ms]
                                </span>
                              )}
                              {lazyWinsTime && <span className="winner-indicator">✓ Faster</span>}
                            </>
                          ) : (
                            <span className="error-text">Error: {result.lazyImage.error || 'Processing failed'}</span>
                          )}
                        </div>
                        {result.lazyImage.size != null && (
                          <div className="size-value">
                            {formatBytes(result.lazyImage.size)}
                            {lazyWinsSize && <span className="winner-indicator-size">✓ Smaller</span>}
                          </div>
                        )}
                        {result.lazyImage.memoryUsed != null && (
                          <div className="memory-value" title="Memory usage during processing">
                            💾 {formatMemory(result.lazyImage.memoryUsed)}
                            {lazyWinsMemory && <span className="winner-indicator-memory">✓ Less Memory</span>}
                          </div>
                        )}
                      </>
                    ) : (
                      '×'
                    )}
                  </td>
                  <td className={`result-cell ${sharpWinsTime || sharpWinsSize || sharpWinsMemory ? 'winner' : ''} ${!result.sharp?.supported ? 'not-supported' : ''}`}>
                    {result.sharp?.supported ? (
                      <>
                        <div className="time-value">
                          {result.sharp.time != null ? (
                            <>
                              <span>{result.sharp.time}ms</span>
                              {sharpWinsTime && <span className="winner-indicator">✓ Faster</span>}
                            </>
                          ) : (
                            <span className="error-text">Error: {result.sharp.error || 'Processing failed'}</span>
                          )}
                        </div>
                        {result.sharp.size != null && (
                          <div className="size-value">
                            {formatBytes(result.sharp.size)}
                            {sharpWinsSize && <span className="winner-indicator-size">✓ Smaller</span>}
                          </div>
                        )}
                        {result.sharp.memoryUsed != null && (
                          <div className="memory-value" title="Memory usage during processing">
                            💾 {formatMemory(result.sharp.memoryUsed)}
                            {sharpWinsMemory && <span className="winner-indicator-memory">✓ Less Memory</span>}
                          </div>
                        )}
                      </>
                    ) : (
                      '×'
                    )}
                  </td>
                  
                  {/* Quality Column */}
                  <td className="result-cell">
                    {(result.lazyImage?.ssim != null || result.sharp?.ssim != null) ? (
                       <div className="quality-container">
                         {result.lazyImage?.ssim != null && (
                           <div className={`quality-value ${lazyWinsQuality ? 'quality-winner' : ''}`}>
                             <span className="label">Lazy:</span>
                             <span className="metric">S:{result.lazyImage.ssim.toFixed(4)}</span>
                             <span className="metric-sep">/</span>
                             <span className="metric">P:{result.lazyImage.psnr}dB</span>
                             {lazyWinsQuality && <span className="winner-indicator-quality">✓ Better</span>}
                           </div>
                         )}
                         {result.sharp?.ssim != null && (
                           <div className={`quality-value ${sharpWinsQuality ? 'quality-winner' : ''}`}>
                             <span className="label">Sharp:</span>
                             <span className="metric">S:{result.sharp.ssim.toFixed(4)}</span>
                             <span className="metric-sep">/</span>
                             <span className="metric">P:{result.sharp.psnr}dB</span>
                             {sharpWinsQuality && <span className="winner-indicator-quality">✓ Better</span>}
                           </div>
                         )}
                       </div>
                    ) : (
                      <span className="text-secondary">-</span>
                    )}
                  </td>

                  <td>
                    <div className="bar-container">
                      {result.lazyImage?.time && (
                        <div className="bar-wrapper">
                          <span className="bar-label">lazy-image</span>
                          <div
                            className="bar lazy"
                            style={{ width: `${(result.lazyImage.time / maxTime) * 150}px` }}
                          ></div>
                        </div>
                      )}
                      {result.sharp?.time && (
                        <div className="bar-wrapper">
                          <span className="bar-label">sharp</span>
                          <div
                            className="bar sharp"
                            style={{ width: `${(result.sharp.time / maxTime) * 150}px` }}
                          ></div>
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="bar-container">
                      {result.lazyImage?.size && (
                        <div className="bar-wrapper">
                          <span className="bar-label">lazy-image</span>
                          <div
                            className="bar lazy"
                            style={{ width: `${(result.lazyImage.size / maxSize) * 150}px` }}
                          ></div>
                        </div>
                      )}
                      {result.sharp?.size && (
                        <div className="bar-wrapper">
                          <span className="bar-label">sharp</span>
                          <div
                            className="bar sharp"
                            style={{ width: `${(result.sharp.size / maxSize) * 150}px` }}
                          ></div>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PreviewSection({ results, selectedPreview, setSelectedPreview, getSelectedImages }) {
  const selectedResult = getSelectedImages();
  
  if (!selectedResult) return null;

  return (
    <div className="preview-section">
      <div className="preview-header">
        <h3>Generated Image Preview</h3>
        <div className="preview-tabs">
          {results.categories.map((cat, catIdx) => (
            cat.results.map((res, resIdx) => (
              <button
                key={`${catIdx}-${resIdx}`}
                className={`preview-tab ${selectedPreview?.category === catIdx && selectedPreview?.result === resIdx ? 'active' : ''}`}
                onClick={() => setSelectedPreview({ category: catIdx, result: resIdx })}
              >
                {res.operation.length > 15 ? res.operation.substring(0, 15) + '...' : res.operation}
              </button>
            ))
          ))}
        </div>
      </div>
      <div className="preview-grid">
        {selectedResult.lazyImage?.url && (
          <div className="preview-card">
            <div className="preview-card-header">
              <h4>lazy-image</h4>
              <div className="preview-stats">
                 {selectedResult.lazyImage.time != null ? (
                   <>
                     <span>
                       {selectedResult.lazyImage.time}ms
                       {selectedResult.lazyImage.totalTime != null && selectedResult.lazyImage.totalTime !== selectedResult.lazyImage.time && (
                         <span className="total-time"> (Total: {selectedResult.lazyImage.totalTime}ms)</span>
                       )}
                       {selectedResult.lazyImage.avifConversionTime != null && (
                         <span className="avif-conversion-time"> [AVIF: {selectedResult.lazyImage.avifConversionTime}ms]</span>
                       )}
                     </span>
                     {selectedResult.lazyImage.size != null && <span> / {formatBytes(selectedResult.lazyImage.size)}</span>}
                     {selectedResult.lazyImage.memoryUsed != null && <span> / 💾 {formatMemory(selectedResult.lazyImage.memoryUsed)}</span>}
                     {selectedResult.lazyImage.ssim && (
                       <span className="preview-quality"> / SSIM: {selectedResult.lazyImage.ssim.toFixed(4)}</span>
                     )}
                   </>
                 ) : (
                   <span>Error: {selectedResult.lazyImage.error || 'Processing failed'}</span>
                 )}
              </div>
            </div>
            <img src={selectedResult.lazyImage.url} alt="lazy-image output" />
          </div>
        )}
        {selectedResult.sharp?.url && (
          <div className="preview-card">
            <div className="preview-card-header">
              <h4>sharp</h4>
              <div className="preview-stats">
                 {selectedResult.sharp.time != null ? (
                   <>
                     <span>{selectedResult.sharp.time}ms</span>
                     {selectedResult.sharp.size != null && <span> / {formatBytes(selectedResult.sharp.size)}</span>}
                     {selectedResult.sharp.memoryUsed != null && <span> / 💾 {formatMemory(selectedResult.sharp.memoryUsed)}</span>}
                     {selectedResult.sharp.ssim && (
                       <span className="preview-quality"> / SSIM: {selectedResult.sharp.ssim.toFixed(4)}</span>
                     )}
                   </>
                 ) : (
                   <span>Error: {selectedResult.sharp.error || 'Processing failed'}</span>
                 )}
              </div>
            </div>
            <img src={selectedResult.sharp.url} alt="sharp output" />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

