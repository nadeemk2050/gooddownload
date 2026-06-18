const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const ytDlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const frontendDist = path.join(__dirname, '../frontend/dist');
const cookiesPath = path.join(__dirname, 'cookies.txt');
const settingsPath = path.join(__dirname, 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {}
  return { downloadDir: path.join(os.homedir(), 'Downloads', 'TubeSprint') };
}

function saveSettings(settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

let currentSettings = loadSettings();
if (!fs.existsSync(currentSettings.downloadDir)) {
  fs.mkdirSync(currentSettings.downloadDir, { recursive: true });
}

const ytDlpSharedOptions = {
  noWarnings: true,
  noCheckCertificates: true,
  noPlaylist: true,
  extractorArgs: 'youtube:player_client=ios,android,web,tv_embedded',
  cacheDir: path.join(os.tmpdir(), 'yt-dlp-cache'),
};

const analyzeAttemptOptions = [
  {
    ...ytDlpSharedOptions,
    dumpSingleJson: true,
    skipDownload: true,
  },
  {
    ...ytDlpSharedOptions,
    extractorArgs: 'youtube:player_client=web',
    dumpSingleJson: true,
    skipDownload: true,
  },
  {
    noWarnings: true,
    noCheckCertificates: true,
    noPlaylist: true,
    cacheDir: path.join(os.tmpdir(), 'yt-dlp-cache'),
    dumpSingleJson: true,
    skipDownload: true,
  },
];

if (fs.existsSync(cookiesPath)) {
  console.log('Using cookies.txt for YouTube authentication.');
  ytDlpSharedOptions.cookies = cookiesPath;
}

function normalizeYouTubeUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    if (parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be')) {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function getErrorDetail(error) {
  const raw = error?.stderr || error?.message || error;
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw || 'Unknown yt-dlp error');
  }
}

async function analyzeWithFallback(url) {
  let lastError = null;

  for (const options of analyzeAttemptOptions) {
    try {
      return await ytDlp(url, options);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Unknown yt-dlp error');
}

function mapAnalyzeError(error) {
  const detail = getErrorDetail(error);

  if (detail.includes('Sign in to confirm you\'re not a bot') || detail.includes('Use --cookies-from-browser')) {
    return {
      status: 403,
      message: 'This video currently requires bot verification or cookies. Try another link or add cookies.txt to backend.',
      detail,
    };
  }

  if (detail.includes('Video unavailable') || detail.includes('Private video')) {
    return {
      status: 404,
      message: 'This video is unavailable or private.',
      detail,
    };
  }

  if (detail.includes('Unsupported URL')) {
    return {
      status: 400,
      message: 'Unsupported URL. Please provide a valid YouTube video URL.',
      detail,
    };
  }

  if (detail.includes('Incomplete data received')) {
    return {
      status: 502,
      message: 'YouTube returned incomplete data. Please try again in a few seconds.',
      detail,
    };
  }

  return {
    status: 500,
    message: 'Failed to analyze video. Try again in a moment.',
    detail,
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'tube-sprint-backend' });
});

app.post('/api/search', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Missing search query' });

    console.log(`Searching for: ${query}`);

    // Use ytsearch to get 15 results
    const results = await ytDlp(`ytsearch15:${query}`, {
      ...ytDlpSharedOptions,
      dumpSingleJson: true,
      flatPlaylist: true,
    });

    const entries = (results.entries || []).map(entry => ({
      id: entry.id,
      url: `https://www.youtube.com/watch?v=${entry.id}`,
      title: entry.title,
      thumbnail: entry.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
      duration: entry.duration_string || '0:00',
      author: entry.uploader || 'Unknown Channel',
    }));

    res.json({ results: entries });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Failed to fetch search results' });
  }
});

app.post('/api/analyze', async (req, res) => {
  try {
    const { url } = req.body;
    const normalized = normalizeYouTubeUrl(url);

    if (!normalized) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    console.log(`Analyzing: ${normalized}`);

    const info = await analyzeWithFallback(normalized);

    const isLive = !!info.is_live;
    const isPlaylist = Array.isArray(info.entries);

    if (isPlaylist) {
      return res.status(400).json({ error: 'Playlists are not supported. Please use a single video URL.' });
    }

    const title = info.title || 'Unknown Title';
    const thumbnail = info.thumbnail || '';
    const duration = info.duration || 0;
    const durationText = info.duration_string || '0:00';
    const author = info.uploader || info.channel || 'Unknown Author';

    const formats = {
      video: [],
      audio: [],
    };

    if (info.formats) {
      info.formats.forEach((f) => {
        const hasVideo = f.vcodec && f.vcodec !== 'none';
        const hasAudio = f.acodec && f.acodec !== 'none';

        const entry = {
          itag: f.format_id,
          qualityLabel: f.quality || f.format_note || (hasVideo ? `${f.height}p` : 'Audio'),
          container: f.ext || 'mp4',
          approxSize: f.filesize || f.filesize_approx || 0,
          url: f.url,
          hasVideo,
          hasAudio,
        };

        if (hasVideo) {
          formats.video.push(entry);
        } else if (hasAudio) {
          formats.audio.push(entry);
        }
      });
    }

    // Sort formats
    formats.video.sort((a, b) => (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0));
    formats.audio.sort((a, b) => (parseInt(b.approxSize) || 0) - (parseInt(a.approxSize) || 0));

    res.json({
      url: normalized,
      title,
      thumbnail,
      duration,
      durationText,
      author,
      isLive,
      formats,
    });
  } catch (err) {
    const publicError = mapAnalyzeError(err);
    console.error('yt-dlp error detail:', publicError.detail);
    return res.status(publicError.status).json(publicError);
  }
});

// ── Best Audio (M4A) download ──
// This is better than MP3 because it's native to YouTube (no conversion needed)
app.get('/api/download-best-audio', async (req, res) => {
  try {
    const { url, ext = 'm4a' } = req.query;
    if (!url) return res.status(400).send('Missing url parameter');

    const normalized = normalizeYouTubeUrl(url);
    if (!normalized) return res.status(400).send('Invalid URL');

    console.log(`Best Audio (${ext}) download: ${normalized}`);

    // ba[ext=m4a] picks the best audio-only stream in m4a format (native AAC)
    // This works WITHOUT ffmpeg!
    const downloadProcess = ytDlp.exec(normalized, {
      ...ytDlpSharedOptions,
      format: `ba[ext=${ext}]/ba`,
      output: '-',
    });

    res.setHeader('Content-Type', ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4');
    res.setHeader('Content-Disposition', 'attachment');

    downloadProcess.stdout.pipe(res);

    downloadProcess.on('error', (err) => {
      console.error('Download process error:', err);
      if (!res.headersSent) res.status(500).send('Download failed');
    });
  } catch (error) {
    console.error('SERVER ERROR IN /api/download-best-audio:', error);
    if (!res.headersSent) res.status(500).send('Internal Server Error');
  }
});

// ── MP3 download (converts best audio to MP3 via yt-dlp) ──
app.get('/api/download-mp3', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing url parameter');

    const normalized = normalizeYouTubeUrl(url);
    if (!normalized) return res.status(400).send('Invalid URL');

    console.log(`MP3 download requested: ${normalized}`);

    // Since ffmpeg might be missing, we'll try to convert, but if it fails, 
    // we should have a fallback. However, yt-dlp's --extract-audio REQUIRES ffmpeg.
    
    const tmpDir = path.join(os.tmpdir(), 'naddownload-mp3');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpTemplate = path.join(tmpDir, `%(title)s-${Date.now()}.%(ext)s`);

    const ytDlpProcess = ytDlp.exec(normalized, {
      ...ytDlpSharedOptions,
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: '0',
      output: tmpTemplate,
    });

    let outFile = null;

    ytDlpProcess.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      const m = text.match(/Destination:\s*(.+\.mp3)/i);
      if (m) outFile = m[1].trim();
    });

    ytDlpProcess.on('close', (code) => {
      if (code !== 0 || !outFile || !fs.existsSync(outFile)) {
        console.error(`MP3 conversion failed (code ${code}). Is ffmpeg installed?`);
        if (!res.headersSent) {
          res.status(500).json({ 
            error: 'MP3 conversion failed', 
            detail: 'FFmpeg is likely not installed on this system. Please use the "Best M4A" option instead, which is native and works without FFmpeg.' 
          });
        }
        return;
      }

      const baseName = path.basename(outFile);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(baseName)}"`);
      const stat = fs.statSync(outFile);
      res.setHeader('Content-Length', stat.size);

      const readStream = fs.createReadStream(outFile);
      readStream.pipe(res);
      readStream.on('close', () => {
        try { fs.unlinkSync(outFile); } catch { /* ignore */ }
      });
    });

    ytDlpProcess.on('error', (err) => {
      if (!res.headersSent) res.status(500).send('Internal Server Error');
    });
  } catch (error) {
    if (!res.headersSent) res.status(500).send('Internal Server Error');
  }
});


app.get('/api/download', async (req, res) => {
  try {
    const { url, itag } = req.query;
    if (!url || !itag) {
      return res.status(400).send('Missing url or itag parameters');
    }

    const normalized = normalizeYouTubeUrl(url);
    if (!normalized) return res.status(400).send('Invalid URL');

    console.log(`Downloading: ${normalized} [${itag}]`);

    // Stream the download directly to the response
    const downloadProcess = ytDlp.exec(normalized, {
      ...ytDlpSharedOptions,
      format: itag,
      output: '-',
    });

    res.setHeader('Content-Disposition', 'attachment');

    downloadProcess.stdout.pipe(res);

    downloadProcess.on('error', (err) => {
      console.error('Download process error:', err);
      if (!res.headersSent) {
        res.status(500).send('Internal Server Error while starting download');
      }
    });

    downloadProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`Download process exited with code ${code}`);
      }
    });
  } catch (error) {
    console.error('SERVER ERROR IN /api/download:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error');
    }
  }
});

app.get('/api/settings', (req, res) => res.json(currentSettings));

app.post('/api/settings', (req, res) => {
  const { downloadDir } = req.body;
  if (!downloadDir) return res.status(400).json({ error: 'Missing path' });
  
  try {
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }
    currentSettings.downloadDir = downloadDir;
    saveSettings(currentSettings);
    res.json({ success: true, path: downloadDir });
  } catch (err) {
    res.status(500).json({ error: 'Invalid or inaccessible path.' });
  }
});

app.post('/api/open-system', (req, res) => {
  const { fileName, action } = req.body;
  if (!fileName) return res.status(400).json({ error: 'Missing filename' });

  const filePath = path.join(currentSettings.downloadDir, fileName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `File not found in: ${currentSettings.downloadDir}` });
  }

  const command = action === 'play' ? `start "" "${filePath}"` : `explorer.exe /select,"${filePath}"`;
  exec(command, (err) => {
    if (err) return res.status(500).json({ error: 'Failed to execute system action.' });
    res.json({ success: true, path: filePath });
  });
});

app.post('/api/delete-file', (req, res) => {
  const { fileName } = req.body;
  if (!fileName) return res.status(400).json({ error: 'Missing filename' });

  const filePath = path.join(currentSettings.downloadDir, fileName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on disk.' });
  }

  fs.unlink(filePath, (err) => {
    if (err) return res.status(500).json({ error: 'Failed to delete file.' });
    res.json({ success: true });
  });
});

app.get('/api/download-to-local', async (req, res) => {
  try {
    const { url, itag, fileName, type } = req.query;
    if (!url || !fileName) return res.status(400).send('Missing params');

    const dest = path.join(currentSettings.downloadDir, fileName);
    console.log(`[DOWNLOAD] Type: ${type}, Format: ${itag}, File: ${fileName}`);

    // Robust format selection
    let formatSelection;
    if (type === 'audio') {
      // If it's audio, we want best audio. 'ba' is shorthand for 'bestaudio'
      formatSelection = itag && itag !== 'bestaudio' ? `${itag}/ba/b` : 'ba/b';
    } else {
      // If it's video, we want the specific itag or the best combined
      formatSelection = itag ? `${itag}+ba/b` : 'bv+ba/b';
    }

    const options = {
      ...ytDlpSharedOptions,
      format: formatSelection,
      output: dest,
    };

    await ytDlp(url, options);
    res.json({ success: true, path: dest });
  } catch (err) {
    console.error('Download Error:', err.stderr || err.message);
    res.status(500).json({ error: err.stderr || err.message || 'Download failed.' });
  }
});

app.use(express.static(frontendDist));

app.get(/.*/, (req, res) => {
  const indexFile = path.join(frontendDist, 'index.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.status(404).send('Application UI not built. Please run "npm run build" in the root folder.');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TubeSprint Local is running!`);
  console.log(`URL: http://localhost:${PORT}`);
});
