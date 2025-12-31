import { useState, useCallback } from 'react';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getMaxTime(results) {
  let max = 0;
  results.forEach(r => {
    if (r.lazyImage?.time) max = Math.max(max, r.lazyImage.time);
    if (r.sharp?.time) max = Math.max(max, r.sharp.time);
  });
  return max || 100;
}

function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedPreview, setSelectedPreview] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleUpload = useCallback(async (file) => {
    // ファイルサイズチェック（10GB制限）
    const maxSize = 10 * 1024 * 1024 * 1024; // 10GB
    if (file.size > maxSize) {
      setError(`ファイルサイズが大きすぎます。最大10GBまで対応しています。現在のファイル: ${formatBytes(file.size)}`);
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
        <p>画像処理ライブラリのリアルタイムベンチマーク比較</p>
        <div className="version-badges">
          <span className="badge rust">lazy-image {results?.versions?.lazyImage || '0.8.x'}</span>
          <span className="badge sharp">sharp {results?.versions?.sharp || 'latest'}</span>
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
        <h3>ドラッグ&ドロップで画像をアップロード</h3>
        <p>または クリックしてファイルを選択 (JPEG, PNG, WebP, AVIF)</p>
        <p className="uploader-note">最大10GBまで対応</p>
        {selectedFile && (
          <div className="selected-file-info">
            <span className="file-name">{selectedFile.name}</span>
            <span className="file-size">{formatBytes(selectedFile.size)}</span>
            {selectedFile.size > 100 * 1024 * 1024 && (
              <span className="file-warning">⚠️ 大きなファイルです。処理に時間がかかる場合があります。</span>
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
          <p>ベンチマーク実行中...</p>
          {uploadProgress > 0 && uploadProgress < 100 && (
            <div className="upload-progress">
              <div className="progress-bar-container">
                <div 
                  className="progress-bar" 
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
              <p className="progress-text">アップロード中: {Math.round(uploadProgress)}%</p>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="error">
          <p>エラー: {error}</p>
        </div>
      )}

      {results && (
        <>
          <div className="original-info">
            <div className="original-details">
              <h3>オリジナル画像</h3>
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
              <th>操作</th>
              <th>lazy-image</th>
              <th>sharp</th>
              <th>処理時間比較</th>
            </tr>
          </thead>
          <tbody>
            {category.results.map((result, resIdx) => {
              const lazyWins = result.lazyImage?.supported && result.sharp?.supported 
                && result.lazyImage.time != null && result.sharp.time != null
                && result.lazyImage.time < result.sharp.time;
              const sharpWins = result.lazyImage?.supported && result.sharp?.supported 
                && result.lazyImage.time != null && result.sharp.time != null
                && result.sharp.time < result.lazyImage.time;
              
              const isSelected = selectedPreview?.category === catIdx && selectedPreview?.result === resIdx;

              return (
                <tr
                  key={resIdx}
                  onClick={() => setSelectedPreview({ category: catIdx, result: resIdx })}
                  style={{ cursor: 'pointer', background: isSelected ? 'rgba(88, 166, 255, 0.1)' : undefined }}
                >
                  <td className="operation-name">{result.operation}</td>
                  <td className={`result-cell ${lazyWins ? 'winner' : ''} ${!result.lazyImage?.supported ? 'not-supported' : ''}`}>
                    {result.lazyImage?.supported ? (
                      <>
                        <div className="time-value">
                          {result.lazyImage.time != null ? (
                            <>
                              <span>{result.lazyImage.time}ms</span>
                              {lazyWins && <span className="winner-indicator">✓ 勝利</span>}
                            </>
                          ) : (
                            <span className="error-text">エラー: {result.lazyImage.error || '処理失敗'}</span>
                          )}
                        </div>
                        {result.lazyImage.size != null && (
                          <div className="size-value">{formatBytes(result.lazyImage.size)}</div>
                        )}
                      </>
                    ) : (
                      '×'
                    )}
                  </td>
                  <td className={`result-cell ${sharpWins ? 'winner' : ''} ${!result.sharp?.supported ? 'not-supported' : ''}`}>
                    {result.sharp?.supported ? (
                      <>
                        <div className="time-value">
                          {result.sharp.time != null ? (
                            <>
                              <span>{result.sharp.time}ms</span>
                              {sharpWins && <span className="winner-indicator">✓ 勝利</span>}
                            </>
                          ) : (
                            <span className="error-text">エラー: {result.sharp.error || '処理失敗'}</span>
                          )}
                        </div>
                        {result.sharp.size != null && (
                          <div className="size-value">{formatBytes(result.sharp.size)}</div>
                        )}
                      </>
                    ) : (
                      '×'
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
        <h3>生成画像プレビュー</h3>
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
              <span>
                {selectedResult.lazyImage.time != null 
                  ? `${selectedResult.lazyImage.time}ms / ${formatBytes(selectedResult.lazyImage.size)}`
                  : `エラー: ${selectedResult.lazyImage.error || '処理失敗'}`}
              </span>
            </div>
            <img src={selectedResult.lazyImage.url} alt="lazy-image output" />
          </div>
        )}
        {selectedResult.sharp?.url && (
          <div className="preview-card">
            <div className="preview-card-header">
              <h4>sharp</h4>
              <span>
                {selectedResult.sharp.time != null 
                  ? `${selectedResult.sharp.time}ms / ${formatBytes(selectedResult.sharp.size)}`
                  : `エラー: ${selectedResult.sharp.error || '処理失敗'}`}
              </span>
            </div>
            <img src={selectedResult.sharp.url} alt="sharp output" />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

