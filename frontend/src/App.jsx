import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Search, Download, Video, Music, History, RefreshCw, X, Play, 
  ChevronLeft, Folder, ExternalLink, MoreVertical, FileVideo, FileAudio, Trash2, Settings
} from 'lucide-react';
import './App.css';

const APP_VERSION = 'v1.7';
const HISTORY_KEY = 'naddownload_history';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

function apiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
}

function bytesToReadable(value) {
  if (!value) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = Number(value);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '').trim() || 'video';
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

function App() {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('video');
  const [downloadingKey, setDownloadingKey] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isInstalled, setIsInstalled] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches,
  );

  const [progress, setProgress] = useState(null);
  const [history, setHistory] = useState(() => loadHistory());
  const [showHistory, setShowHistory] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historySortDesc, setHistorySortDesc] = useState(true);

  // Backend Settings
  const [backendPath, setBackendPath] = useState('');
  const [isPathEditing, setIsPathEditing] = useState(false);

  const activeFormats = useMemo(() => {
    if (!data) return [];
    if (activeTab === 'best-audio') return data.formats.bestAudio || [];
    return activeTab === 'video' ? data.formats.video : data.formats.audio;
  }, [activeTab, data]);

  const filteredHistory = useMemo(() => {
    let result = history;
    if (historySearch) {
      const lower = historySearch.toLowerCase();
      result = result.filter(h => h.name.toLowerCase().includes(lower) || h.date.toLowerCase().includes(lower));
    }
    result = [...result].sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return historySortDesc ? dateB - dateA : dateA - dateB;
    });
    return result;
  }, [history, historySearch, historySortDesc]);

  useEffect(() => {
    fetch(apiUrl('/settings'))
      .then(res => res.json())
      .then(s => setBackendPath(s.downloadDir))
      .catch(() => console.error('Could not fetch backend settings'));
  }, []);

  function handleRefresh() {
    setRefreshing(true);
    setTimeout(() => window.location.reload(), 500);
  }

  async function updateBackendPath() {
    try {
      const res = await fetch(apiUrl('/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ downloadDir: backendPath }),
      });
      if (res.ok) {
        setIsPathEditing(false);
        setStatusMessage('Download path updated.');
      } else {
        const p = await res.json();
        alert(p.error || 'Invalid path.');
      }
    } catch {
      alert('Failed to update path.');
    }
  }

  async function handleSearchOrAnalyze(e) {
    if (e) e.preventDefault();
    const val = query.trim();
    if (!val) return;
    setError('');
    const isUrl = val.includes('youtube.com/') || val.includes('youtu.be/');
    if (isUrl) handleAnalyze(val);
    else handleSearch(val);
  }

  async function handleSearch(term) {
    setSearching(true);
    setSearchResults([]);
    setData(null);
    try {
      const res = await fetch(apiUrl('/search'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: term }),
      });
      const payload = await res.json();
      if (res.ok) setSearchResults(payload.results);
      else setError(payload.error || 'Search failed');
    } catch {
      setError('Could not connect to search engine.');
    } finally {
      setSearching(false);
    }
  }

  async function handleAnalyze(targetUrl) {
    setLoading(true);
    setError('');
    setData(null);
    try {
      const response = await fetch(apiUrl('/analyze'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });
      const payload = await response.json();
      if (response.ok) {
        payload.formats.bestAudio = [{ itag: 'bestaudio', qualityLabel: 'High Quality Audio (M4A)', container: 'm4a', approxSize: 0, isBestAudio: true }];
        setData(payload);
      } else {
        setError(payload.message || 'Analysis failed.');
      }
    } catch {
      setError('Could not connect to backend.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload(format) {
    setStatusMessage('');
    setProgress({ percent: -1, fileName: 'Starting...' });
    const downloadKey = format.isBestAudio ? `best-${format.container}` : `${activeTab}-${format.itag}`;
    setDownloadingKey(downloadKey);

    let safeTitle = sanitizeFileName(data?.title || 'media');
    // Remove existing extensions if any (like .mp4 at the end of the title)
    safeTitle = safeTitle.replace(/\.(mp4|m4a|webm|mp3)$/i, '');

    const fileName = format.isBestAudio 
          ? `${safeTitle}.${format.container}`
          : `${safeTitle} [${format.qualityLabel}].${format.container}`;

    const isAudioType = activeTab === 'audio' || activeTab === 'best-audio';

    try {
      const res = await fetch(`${apiUrl('/download-to-local')}?url=${encodeURIComponent(data.url)}&itag=${format.itag || ''}&fileName=${encodeURIComponent(fileName)}&type=${isAudioType ? 'audio' : 'video'}`);
      
      if (res.ok) {
        addToHistory({ date: new Date().toLocaleString(), url: data.url, name: fileName, downloaded: 'Yes' });
        setStatusMessage('Saved to your folder!');
      } else {
        const errPayload = await res.json().catch(() => ({}));
        throw new Error(errPayload.error || 'Download failed');
      }
    } catch (err) {
      setStatusMessage(err.message || 'Download failed.');
    } finally {
      setDownloadingKey('');
      setProgress(null);
    }
  }

  async function handleSystemOpen(item, action) {
    setModalLoading(true);
    try {
      const res = await fetch(apiUrl('/open-system'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: item.name, action }),
      });
      const payload = await res.json();
      if (!res.ok) alert(payload.error || 'Failed to open file.');
      else setSelectedHistoryItem(null);
    } catch {
      alert('Could not connect to local engine for OS features.');
    } finally {
      setModalLoading(false);
    }
  }

  async function handleDeleteHistoryItem(item, deleteFromDisk) {
    if (deleteFromDisk) {
      try {
        const res = await fetch(apiUrl('/delete-file'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: item.name }),
        });
        const payload = await res.json();
        if (!res.ok) {
          alert(payload.error || 'Failed to delete file from disk.');
        }
      } catch {
        alert('Could not connect to local engine for deletion.');
        return;
      }
    }

    setHistory(prev => {
      const next = prev.filter(h => h.date !== item.date || h.name !== item.name);
      saveHistory(next);
      return next;
    });

    setSelectedHistoryItem(null);
    setShowDeleteConfirm(false);
  }

  function addToHistory(entry) {
    setHistory(prev => {
      const next = [entry, ...prev].slice(0, 100);
      saveHistory(next);
      return next;
    });
  }

  return (
    <main className="app-shell">
      <section className="panel">
        <header className="header-row">
          <div>
            <h1>NADDOWNLOAD</h1>
            <span className="version-badge">{APP_VERSION}</span>
          </div>
          <button className="refresh-btn" onClick={handleRefresh}>
            <RefreshCw size={20} className={refreshing ? 'spin' : ''} />
          </button>
        </header>

        <p className="intro">Professional YouTube management. Play, Open or Delete files directly from history.</p>

        <div className="status-pills">
          {isInstalled && <span className="pill ok">Desktop Mode</span>}
          <span className="pill ok">Engine: Online</span>
          <span className="pill ok">Storage: Reliable</span>
        </div>

        <div className="folder-bar">
          <div>
            <p>Download Destination Path:</p>
            {isPathEditing ? (
              <input 
                type="text" 
                value={backendPath} 
                onChange={(e) => setBackendPath(e.target.value)} 
                onBlur={updateBackendPath}
                autoFocus
                className="path-input"
              />
            ) : (
              <strong onClick={() => setIsPathEditing(true)} style={{ cursor: 'pointer' }}>{backendPath || 'Loading...'}</strong>
            )}
          </div>
          <button className="secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => setIsPathEditing(!isPathEditing)}>
            {isPathEditing ? 'Save' : 'Edit Path'}
          </button>
        </div>

        <form className="analyze-form" onSubmit={handleSearchOrAnalyze}>
          <div className="row">
            <div className="input-wrapper">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search keywords or paste URL..."
                required
              />
              {query && <button type="button" className="clear-btn" onClick={() => setQuery('')}><X size={16} /></button>}
            </div>
            <button type="submit" disabled={loading || searching}>
              {loading || searching ? '...' : <Search size={20} />}
            </button>
          </div>
        </form>

        {error && <p className="message error">{error}</p>}

        <AnimatePresence mode="wait">
          {data ? (
            <motion.div 
              key="analyze" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="result"
            >
              <button className="secondary" onClick={() => setData(null)} style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ChevronLeft size={16} /> Back to results
              </button>
              
              <div className="video-meta">
                <img src={data.thumbnail} alt={data.title} />
                <div>
                  <h2>{data.title}</h2>
                  <p>{data.author} • {data.durationText}</p>
                  <div className="tabs">
                    {['video', 'audio', 'best-audio'].map(tab => (
                      <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
                        {tab === 'best-audio' ? 'Best Audio' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="format-list">
                {activeFormats.map(f => (
                  <article key={f.itag} className="format-card">
                    <div>
                      <strong>{f.qualityLabel}</strong>
                      <p>{f.container.toUpperCase()} {f.approxSize > 0 ? `• ${bytesToReadable(f.approxSize)}` : ''}</p>
                    </div>
                    <button onClick={() => handleDownload(f)} disabled={downloadingKey}>
                      {downloadingKey === (f.isBestAudio ? `best-${f.container}` : `${activeTab}-${f.itag}`) ? '...' : <Download size={18} />}
                    </button>
                  </article>
                ))}
              </div>
              
              {progress && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="progress-container" style={{ marginBottom: '1.5rem' }}>
                  <div className="progress-info">
                    <span className="progress-filename">{progress.fileName}</span>
                    <span className="progress-stats">
                      {progress.percent >= 0 ? <>Saving directly to disk... <strong>{progress.percent}%</strong></> : <strong>Downloading to local storage...</strong>}
                    </span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill indeterminate" style={{ width: '100%' }} />
                  </div>
                </motion.div>
              )}
            </motion.div>
          ) : (
            <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="search-results">
              {searching ? (
                Array.from({ length: 6 }).map((_, i) => <div key={i} className="search-card skeleton" style={{ height: '180px' }} />)
              ) : (
                searchResults.map(item => (
                  <motion.div layoutId={item.id} key={item.id} className="search-card" onClick={() => { setQuery(item.url); handleAnalyze(item.url); }}>
                    <div className="search-thumbnail">
                      <img src={item.thumbnail} alt={item.title} />
                      <span className="search-duration">{item.duration}</span>
                    </div>
                    <div className="search-info">
                      <h3>{item.title}</h3>
                      <p>{item.author}</p>
                    </div>
                  </motion.div>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {statusMessage && <p className="message status">{statusMessage}</p>}

        <div className="history-section">
          <button className="history-toggle" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? '▲' : '▼'} History ({history.length})
          </button>
          {showHistory && (
            <div className="history-controls" style={{ display: 'flex', gap: '10px', marginBottom: '10px', marginTop: '10px' }}>
              <input 
                type="text" 
                placeholder="Search history..." 
                value={historySearch} 
                onChange={e => setHistorySearch(e.target.value)} 
                className="path-input"
                style={{ flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid #e0e0e0' }}
              />
              <button 
                className="secondary" 
                onClick={() => setHistorySortDesc(!historySortDesc)}
                style={{ padding: '8px 12px', fontSize: '13px' }}
              >
                Sort: {historySortDesc ? 'Newest' : 'Oldest'}
              </button>
            </div>
          )}
          {showHistory && (
            <div className="history-table-wrapper">
              <table className="history-table">
                <thead><tr><th>Date</th><th>File</th><th>Status</th><th>Play</th></tr></thead>
                <tbody>
                  {filteredHistory.map((h, i) => (
                    <tr key={i} onClick={() => setSelectedHistoryItem(h)}>
                      <td>{h.date}</td>
                      <td>{h.name}</td>
                      <td className={h.downloaded === 'Yes' ? 'yes' : 'no'}>{h.downloaded}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button 
                          className="secondary" 
                          style={{ padding: '4px', borderRadius: '50%', display: 'inline-flex' }}
                          onClick={(e) => { e.stopPropagation(); handleSystemOpen(h, 'play'); }}
                          title="Play directly"
                        >
                          <Play size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Media Manager Modal */}
      <AnimatePresence>
        {selectedHistoryItem && (
          <div className="modal-overlay" onClick={() => { setSelectedHistoryItem(null); setShowDeleteConfirm(false); }}>
            <motion.div 
              className="modal-content" onClick={e => e.stopPropagation()}
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
            >
              <div className="modal-header">
                <h3>{showDeleteConfirm ? 'Confirm Delete' : 'Media Manager'}</h3>
                <button className="clear-btn" onClick={() => { setSelectedHistoryItem(null); setShowDeleteConfirm(false); }}><X size={24} /></button>
              </div>
              
              <div style={{ marginBottom: '20px' }}>
                <p style={{ margin: '0 0 8px', color: '#8c6f5d', fontSize: '13px' }}>File:</p>
                <strong style={{ display: 'block', wordBreak: 'break-all' }}>{selectedHistoryItem.name}</strong>
              </div>

              {!showDeleteConfirm ? (
                <div className="action-grid">
                  <button className="action-btn" onClick={() => handleSystemOpen(selectedHistoryItem, 'play')} disabled={modalLoading}>
                    <Play size={20} className={modalLoading ? 'spin' : ''} />
                    <div><strong>Play File</strong><p style={{ margin: 0, fontSize: '12px', opacity: 0.8 }}>{modalLoading ? 'Opening...' : 'Open in default media player'}</p></div>
                  </button>

                  <button className="action-btn" onClick={() => handleSystemOpen(selectedHistoryItem, 'folder')} disabled={modalLoading}>
                    <Folder size={20} className={modalLoading ? 'spin' : ''} />
                    <div><strong>Open Folder</strong><p style={{ margin: 0, fontSize: '12px', opacity: 0.8 }}>{modalLoading ? 'Locating...' : 'Show in File Explorer'}</p></div>
                  </button>

                  <button className="action-btn danger" onClick={() => setShowDeleteConfirm(true)} disabled={modalLoading}>
                    <Trash2 size={20} />
                    <div><strong>Remove Item</strong><p style={{ margin: 0, fontSize: '12px', opacity: 0.8 }}>Delete from history or disk</p></div>
                  </button>
                </div>
              ) : (
                <div className="action-grid">
                  <button className="action-btn" onClick={() => handleDeleteHistoryItem(selectedHistoryItem, false)}>
                    <History size={20} />
                    <div><strong>Remove from History Only</strong><p style={{ margin: 0, fontSize: '12px', opacity: 0.8 }}>Keeps the file on your computer</p></div>
                  </button>

                  <button className="action-btn danger" onClick={() => handleDeleteHistoryItem(selectedHistoryItem, true)}>
                    <Trash2 size={20} />
                    <div><strong>Delete from Hard Disk Also</strong><p style={{ margin: 0, fontSize: '12px', opacity: 0.8 }}>Warning: This cannot be undone!</p></div>
                  </button>
                  
                  <button className="secondary" style={{ marginTop: '10px' }} onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main>
  );
}

export default App;
