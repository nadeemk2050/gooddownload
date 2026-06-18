import os
import sys
import json
import uuid
import tempfile
import subprocess
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
import yt_dlp

# Determine the static folder path
# In production (Render), the frontend dist is at frontend/dist relative to project root
# In development, same path
backend_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(backend_dir)
static_dir = os.path.join(project_root, 'frontend', 'dist')

# Auto-build frontend if dist doesn't exist (e.g. fresh deploy on Render)
if not os.path.exists(static_dir):
    print("Frontend dist not found. Building frontend...")
    frontend_dir = os.path.join(project_root, 'frontend')
    
    npm_install = subprocess.run(
        ['npm', 'install', '--legacy-peer-deps', '--prefix', frontend_dir],
        capture_output=True, text=True, cwd=frontend_dir
    )
    if npm_install.returncode != 0:
        print(f"npm install failed: {npm_install.stderr}")
    else:
        npm_build = subprocess.run(
            ['npm', 'run', 'build', '--prefix', frontend_dir],
            capture_output=True, text=True, cwd=frontend_dir
        )
        if npm_build.returncode != 0:
            print(f"npm build failed: {npm_build.stderr}")
        else:
            print("Frontend built successfully.")

app = Flask(__name__, static_folder=static_dir, static_url_path='/')
CORS(app)

PORT = int(os.environ.get("PORT", 4000))
settings_path = os.path.join(os.path.dirname(__file__), 'settings.json')
cookies_path = os.path.join(os.path.dirname(__file__), 'cookies.txt')

def load_settings():
    if os.path.exists(settings_path):
        try:
            with open(settings_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {"downloadDir": os.path.join(os.path.expanduser("~"), "Downloads", "TubeSprint")}

def save_settings(settings):
    with open(settings_path, 'w', encoding='utf-8') as f:
        json.dump(settings, f, indent=2)

current_settings = load_settings()
if not os.path.exists(current_settings["downloadDir"]):
    os.makedirs(current_settings["downloadDir"], exist_ok=True)

def get_base_ydl_opts():
    opts = {
        'quiet': True,
        'no_warnings': True,
        'nocheckcertificate': True,
        'noplaylist': True,
        'cachedir': os.path.join(tempfile.gettempdir(), 'yt-dlp-cache'),
    }
    if os.path.exists(cookies_path):
        opts['cookiefile'] = cookies_path
    return opts

@app.route('/api/health')
def health():
    return jsonify({"ok": True, "service": "tube-sprint-backend"})

@app.route('/api/search', methods=['POST'])
def search():
    data = request.get_json()
    query = data.get('query')
    if not query:
        return jsonify({"error": "Missing search query"}), 400
    
    opts = get_base_ydl_opts()
    opts['extract_flat'] = True
    
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"ytsearch15:{query}", download=False)
            entries = []
            for entry in info.get('entries', []):
                entries.append({
                    "id": entry.get("id"),
                    "url": f"https://www.youtube.com/watch?v={entry.get('id')}",
                    "title": entry.get("title"),
                    "thumbnail": entry.get("thumbnails", [{}])[0].get("url") if entry.get("thumbnails") else f"https://i.ytimg.com/vi/{entry.get('id')}/hqdefault.jpg",
                    "duration": entry.get("duration_string", "0:00"),
                    "author": entry.get("uploader", "Unknown Channel")
                })
            return jsonify({"results": entries})
    except Exception as e:
        print(f"Search error: {e}")
        return jsonify({"error": "Failed to fetch search results"}), 500

@app.route('/api/analyze', methods=['POST'])
def analyze():
    data = request.get_json()
    url = data.get('url')
    if not url:
        return jsonify({"error": "Invalid YouTube URL"}), 400
    
    opts = get_base_ydl_opts()
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            is_live = bool(info.get('is_live'))
            
            video_temp = []
            formats = {"video": [], "audio": []}
            for f in info.get('formats', []):
                if str(f.get('format_id', '')).startswith('sb'):
                    continue
                    
                has_video = f.get('vcodec') != 'none' and f.get('vcodec') is not None
                has_audio = f.get('acodec') != 'none' and f.get('acodec') is not None
                
                entry = {
                    "itag": f.get('format_id'),
                    "qualityLabel": f.get('format_note') or f.get('resolution') or ('Audio' if not has_video else f"{f.get('height', '')}p"),
                    "container": f.get('ext', 'mp4'),
                    "approxSize": f.get('filesize') or f.get('filesize_approx') or 0,
                    "url": f.get('url'),
                    "hasVideo": has_video,
                    "hasAudio": has_audio,
                    "height": f.get('height', 0)
                }
                if has_video:
                    video_temp.append(entry)
                elif has_audio:
                    formats["audio"].append(entry)
                    
            # Sort video temp by height (descending) and then prefer mp4
            video_temp.sort(key=lambda x: (x.get('height') or 0, 1 if x['container'] == 'mp4' else 0), reverse=True)
            
            seen_heights = set()
            for vf in video_temp:
                h = vf.get('height')
                if h and h not in seen_heights:
                    seen_heights.add(h)
                    vf['qualityLabel'] = f"{h}p"
                    formats["video"].append(vf)
            formats["audio"].sort(key=lambda x: x['approxSize'] or 0, reverse=True)
            
            return jsonify({
                "url": url,
                "title": info.get('title', 'Unknown Title'),
                "thumbnail": info.get('thumbnail', ''),
                "duration": info.get('duration', 0),
                "durationText": info.get('duration_string', '0:00'),
                "author": info.get('uploader') or info.get('channel') or 'Unknown Author',
                "isLive": is_live,
                "formats": formats
            })
    except yt_dlp.utils.DownloadError as e:
        err_msg = str(e)
        if "Sign in to confirm" in err_msg:
            return jsonify({"status": 403, "message": "Bot verification required", "detail": err_msg}), 403
        return jsonify({"status": 500, "message": "Failed to analyze video", "detail": err_msg}), 500
    except Exception as e:
        return jsonify({"status": 500, "message": "Failed to analyze video", "detail": str(e)}), 500

@app.route('/api/download-best-audio')
def download_best_audio():
    url = request.args.get('url')
    ext = request.args.get('ext', 'm4a')
    if not url:
        return "Missing url parameter", 400
    
    cmd = [
        'yt-dlp',
        '--format', f'ba[ext={ext}]/ba',
        '--output', '-',
        '--quiet',
        '--no-warnings'
    ]
    if os.path.exists(cookies_path):
        cmd.extend(['--cookies', cookies_path])
    cmd.append(url)
    
    def generate():
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            for chunk in iter(lambda: proc.stdout.read(4096), b""):
                yield chunk
        finally:
            proc.kill()
            
    headers = {
        "Content-Type": "audio/mpeg" if ext == "mp3" else "audio/mp4",
        "Content-Disposition": "attachment"
    }
    return Response(generate(), headers=headers)

@app.route('/api/download-mp3')
def download_mp3():
    url = request.args.get('url')
    if not url:
        return "Missing url parameter", 400
        
    tmp_dir = os.path.join(tempfile.gettempdir(), 'naddownload-mp3')
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_template = os.path.join(tmp_dir, f'%(title)s-{uuid.uuid4().hex}.%(ext)s')
    
    opts = get_base_ydl_opts()
    opts['format'] = 'bestaudio/best'
    opts['postprocessors'] = [{
        'key': 'FFmpegExtractAudio',
        'preferredcodec': 'mp3',
        'preferredquality': '0',
    }]
    opts['outtmpl'] = tmp_template
    
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            # The actual output filename might differ slightly, but extract_info returns the requested info
            # To reliably get the converted file path, yt-dlp replaces the extension with .mp3
            expected_ext = info.get('ext', 'webm')
            # The prepared filename before conversion:
            prepared_filename = ydl.prepare_filename(info)
            # The actual mp3 filename:
            mp3_filename = os.path.splitext(prepared_filename)[0] + '.mp3'
            
            if not os.path.exists(mp3_filename):
                return jsonify({"error": "Conversion failed, FFmpeg might not be installed."}), 500
                
            def generate():
                with open(mp3_filename, 'rb') as f:
                    while chunk := f.read(4096):
                        yield chunk
                try:
                    os.remove(mp3_filename)
                except:
                    pass
                    
            headers = {
                "Content-Type": "audio/mpeg",
                "Content-Disposition": f"attachment; filename=\"{os.path.basename(mp3_filename)}\""
            }
            return Response(generate(), headers=headers)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/download')
def download():
    url = request.args.get('url')
    itag = request.args.get('itag')
    if not url or not itag:
        return "Missing params", 400
        
    cmd = [
        'yt-dlp',
        '--format', itag,
        '--output', '-',
        '--quiet',
        '--no-warnings'
    ]
    if os.path.exists(cookies_path):
        cmd.extend(['--cookies', cookies_path])
    cmd.append(url)
    
    def generate():
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            for chunk in iter(lambda: proc.stdout.read(4096), b""):
                yield chunk
        finally:
            proc.kill()
            
    return Response(generate(), headers={"Content-Disposition": "attachment"})

@app.route('/api/settings', methods=['GET'])
def get_settings():
    return jsonify(current_settings)

@app.route('/api/settings', methods=['POST'])
def set_settings():
    data = request.get_json()
    download_dir = data.get('downloadDir')
    if not download_dir:
        return jsonify({"error": "Missing path"}), 400
        
    os.makedirs(download_dir, exist_ok=True)
    current_settings["downloadDir"] = download_dir
    save_settings(current_settings)
    return jsonify({"success": True, "path": download_dir})

def find_actual_file_path(base_path):
    if os.path.exists(base_path):
        return base_path
    if os.path.exists(base_path + '.mkv'):
        return base_path + '.mkv'
    if os.path.exists(base_path + '.webm'):
        return base_path + '.webm'
    if os.path.exists(base_path.replace('.mp4', '.mkv')):
        return base_path.replace('.mp4', '.mkv')
    if os.path.exists(base_path.replace('.webm', '.mkv')):
        return base_path.replace('.webm', '.mkv')
    return None

@app.route('/api/open-system', methods=['POST'])
def open_system():
    data = request.get_json()
    file_name = data.get('fileName')
    action = data.get('action')
    if not file_name:
        return jsonify({"error": "Missing filename"}), 400
        
    base_path = os.path.join(current_settings["downloadDir"], file_name)
    file_path = find_actual_file_path(base_path)
    if not file_path:
        return jsonify({"error": "File not found"}), 404
        
    try:
        if action == 'play':
            os.startfile(file_path)
        else:
            subprocess.run(['explorer', '/select,', file_path])
        return jsonify({"success": True, "path": file_path})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/delete-file', methods=['POST'])
def delete_file():
    data = request.get_json()
    file_name = data.get('fileName')
    if not file_name:
        return jsonify({"error": "Missing filename"}), 400
        
    base_path = os.path.join(current_settings["downloadDir"], file_name)
    file_path = find_actual_file_path(base_path)
    if not file_path:
        return jsonify({"error": "File not found"}), 404
        
    try:
        os.remove(file_path)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/download-to-local', methods=['GET'])
def download_to_local():
    url = request.args.get('url')
    itag = request.args.get('itag')
    file_name = request.args.get('fileName')
    type_ = request.args.get('type')
    
    if not url or not file_name:
        return "Missing params", 400
        
    dest = os.path.join(current_settings["downloadDir"], file_name)
    
    if type_ == 'audio':
        format_sel = f"{itag}/ba/b" if itag and itag != 'bestaudio' else 'ba/b'
    else:
        format_sel = f"{itag}+ba/b" if itag else 'bv+ba/b'
        
    opts = get_base_ydl_opts()
    opts['format'] = format_sel
    opts['outtmpl'] = dest
    
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
        return jsonify({"success": True, "path": dest})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
        return send_file(os.path.join(app.static_folder, path))
    else:
        return send_file(os.path.join(app.static_folder, 'index.html'))

if __name__ == '__main__':
    from waitress import serve as waitress_serve
    print(f"TubeSprint Python Local Server running on port {PORT}")
    waitress_serve(app, host='0.0.0.0', port=PORT)
