"""
dev-proxy.py — local development proxy for CloudSeed
- Serves static files from web/public_html/
- Proxies POST /rpc to Transmission
- Serves GET /downloads/* directly from Transmission's download directory
- Handles POST /delete for permanent file removal (local dev)
- Streams GET /zip?path=FolderName as a ZIP archive (local dev)
- Handles Range requests so IDM / partial downloads work

Usage:  python dev-proxy.py
Then open: http://localhost:8080
"""
import http.server
import io
import json
import mimetypes
import os
import zipfile
from http import HTTPStatus
import shutil
import urllib.error
import urllib.parse
import urllib.request

STATIC_ROOT      = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web', 'public_html')
TRANSMISSION_RPC = 'http://localhost:9091/transmission/rpc'
PORT             = 8080

_session_id   = ''
_download_dir = ''   # auto-detected from Transmission on first request


def _rpc_raw(method, args, sid=''):
    body = json.dumps({'method': method, 'arguments': args}).encode()
    req  = urllib.request.Request(
        TRANSMISSION_RPC, data=body,
        headers={'Content-Type': 'application/json', 'X-Transmission-Session-Id': sid},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read(), r.headers.get('X-Transmission-Session-Id', sid)


def rpc_call(method, args={}):
    global _session_id
    try:
        data, sid = _rpc_raw(method, args, _session_id)
        _session_id = sid
        return json.loads(data)
    except urllib.error.HTTPError as e:
        if e.code == 409:
            _session_id = e.headers.get('X-Transmission-Session-Id', '')
            data, sid = _rpc_raw(method, args, _session_id)
            _session_id = sid
            return json.loads(data)
        raise


def forward_rpc(body, client_sid=''):
    """Proxy an RPC POST to Transmission, absorbing the 409 session handshake."""
    global _session_id
    sid = client_sid or _session_id
    headers = {
        'Content-Type': 'application/json',
        'X-Transmission-Session-Id': sid,
    }
    req = urllib.request.Request(TRANSMISSION_RPC, data=body, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
            new_sid = resp.headers.get('X-Transmission-Session-Id', '') or sid
            _session_id = new_sid
            return resp.status, new_sid, data
    except urllib.error.HTTPError as e:
        new_sid = e.headers.get('X-Transmission-Session-Id', '') or sid
        if e.code == 409 and new_sid and new_sid != sid:
            _session_id = new_sid
            return forward_rpc(body, new_sid)
        if new_sid:
            _session_id = new_sid
        return e.code, new_sid, e.read()


def get_download_dir():
    global _download_dir
    if _download_dir:
        return _download_dir
    try:
        r = rpc_call('session-get', {'fields': ['download-dir']})
        _download_dir = r.get('arguments', {}).get('download-dir', '')
        if _download_dir:
            print(f'Download dir detected: {_download_dir}')
    except Exception as e:
        print(f'Warning: could not detect download-dir from Transmission: {e}')
    return _download_dir


def safe_join(base, rel):
    """Resolve path and verify it stays inside base."""
    full = os.path.realpath(os.path.join(base, rel.lstrip('/\\')))
    if not full.startswith(os.path.realpath(base)):
        return None
    return full


def prune_empty_dirs(path, root):
    root = os.path.realpath(root)
    current = os.path.dirname(os.path.realpath(path))
    while current.startswith(root + os.sep):
        try:
            os.rmdir(current)
        except OSError:
            break
        current = os.path.dirname(current)


def remove_download_path(dl_dir, rel):
    rel = (rel or '').strip().lstrip('/\\')
    if not rel:
        return 'error', 'empty path'

    root = os.path.realpath(dl_dir)
    removed_any = False
    last_error = None

    for candidate in (rel, os.path.join('.incomplete', rel)):
        full = safe_join(root, candidate)
        if full is None:
            last_error = 'invalid path'
            continue
        if not os.path.lexists(full):
            continue
        try:
            if os.path.isdir(full):
                shutil.rmtree(full)
            else:
                os.remove(full)
            prune_empty_dirs(full, root)
            removed_any = True
        except OSError as exc:
            last_error = str(exc)

    if removed_any:
        return 'deleted', None
    if last_error:
        return 'error', last_error
    return 'missing', None


class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_ROOT, **kwargs)

    # ── GET /downloads/* → serve from Transmission download dir ──────────
    def do_GET(self):
        if self.path.startswith('/downloads/'):
            self._serve_download()
        elif self.path == '/zip' or self.path.startswith('/zip?'):
            self._serve_zip()
        elif self.path.startswith('/.well-known/'):
            # Chrome DevTools probes this path; no file exists in static root
            self.send_error(HTTPStatus.NOT_FOUND)
        else:
            super().do_GET()

    def _serve_download(self):
        dl_dir = get_download_dir()
        if not dl_dir:
            self.send_error(503, 'Download directory not available (Transmission not connected?)')
            return

        rel = urllib.parse.unquote(self.path[len('/downloads/'):])
        full = safe_join(dl_dir, rel)
        if full is None:
            self.send_error(403, 'Path traversal blocked')
            return
        if not os.path.isfile(full):
            self.send_error(404, f'File not found: {rel}')
            return

        file_size = os.path.getsize(full)
        filename  = os.path.basename(full)
        mime, _   = mimetypes.guess_type(full)
        mime      = mime or 'application/octet-stream'

        # Handle Range header (IDM / partial downloads)
        range_header = self.headers.get('Range', '')
        start, end   = 0, file_size - 1
        partial      = False

        if range_header.startswith('bytes='):
            try:
                rng   = range_header[6:].split('-')
                start = int(rng[0]) if rng[0] else 0
                end   = int(rng[1]) if rng[1] else file_size - 1
                partial = True
            except (ValueError, IndexError):
                pass

        length = end - start + 1

        self.send_response(206 if partial else 200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(length))
        self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        self.send_header('Accept-Ranges', 'bytes')
        if partial:
            self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
        self.end_headers()

        try:
            with open(full, 'rb') as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass   # client cancelled the download — normal

    def _serve_zip(self):
        dl_dir = get_download_dir()
        if not dl_dir:
            self.send_error(503, 'Download directory not available (Transmission not connected?)')
            return

        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        rel = (qs.get('path', [''])[0] or '').strip()
        if not rel:
            self.send_error(400, 'Missing path parameter')
            return

        full = safe_join(dl_dir, rel)
        if full is None:
            self.send_error(403, 'Path traversal blocked')
            return
        if not os.path.isdir(full):
            self.send_error(404, f'Folder not found: {rel}')
            return

        zip_name = f'{os.path.basename(full.rstrip("/\\"))}.zip'
        self.send_response(200)
        self.send_header('Content-Type', 'application/zip')
        self.send_header('Content-Disposition', f'attachment; filename="{zip_name}"')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()

        try:
            self._stream_zip(full)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass

    def _stream_zip(self, folder):
        buf = io.BytesIO()
        sent = 0

        def flush_new():
            nonlocal sent
            buf.seek(0, io.SEEK_END)
            end = buf.tell()
            if end <= sent:
                return b''
            buf.seek(sent)
            data = buf.read(end - sent)
            sent = end
            return data

        with zipfile.ZipFile(buf, mode='w', compression=zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
            for root, _dirs, files in os.walk(folder):
                for fname in files:
                    fpath = os.path.join(root, fname)
                    arcname = os.path.relpath(fpath, os.path.dirname(folder))
                    zf.write(fpath, arcname)
                    chunk = flush_new()
                    if chunk:
                        self.wfile.write(chunk)

        tail = flush_new()
        if tail:
            self.wfile.write(tail)

    # ── POST /rpc → proxy to Transmission; POST /delete → remove files ───
    def do_POST(self):
        if self.path == '/delete':
            self._handle_delete()
            return
        if self.path not in ('/rpc', '/transmission/rpc'):
            self.send_error(404)
            return

        length = int(self.headers.get('Content-Length', 0))
        body   = self.rfile.read(length) if length else b'{}'
        client_sid = self.headers.get('X-Transmission-Session-Id', '')

        try:
            status, sid, data = forward_rpc(body, client_sid)
            self._send_rpc_response(status, sid, data)
        except Exception as e:
            msg = f'Proxy error: {e}'.encode()
            self._send_rpc_response(502, '', msg, ct='text/plain')

    def _handle_delete(self):
        dl_dir = get_download_dir()
        if not dl_dir:
            self.send_error(503, 'Download directory not available (Transmission not connected?)')
            return

        length = int(self.headers.get('Content-Length', 0))
        raw = self.rfile.read(length) if length else b'{}'
        try:
            payload = json.loads(raw.decode() or '{}')
        except json.JSONDecodeError:
            self.send_error(400, 'Invalid JSON body')
            return

        paths = payload.get('paths')
        if not isinstance(paths, list) or not paths:
            self.send_error(400, 'Missing paths array')
            return

        deleted, missing, errors = [], [], []
        for rel in paths:
            rel_str = str(rel).strip()
            if not rel_str:
                continue
            status, err = remove_download_path(dl_dir, rel_str)
            if status == 'deleted':
                deleted.append(rel_str)
            elif status == 'missing':
                missing.append(rel_str)
            else:
                errors.append({'path': rel_str, 'error': err or 'delete failed'})

        body = json.dumps({'deleted': deleted, 'missing': missing, 'errors': errors}).encode()
        code = 200 if not errors else 207
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_rpc_response(self, status, sid, data, ct='application/json'):
        try:
            self.send_response(status)
            if sid:
                self.send_header('X-Transmission-Session-Id', sid)
            self.send_header('Content-Type', ct)
            self.send_header('Content-Length', len(data))
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass   # browser navigated away — harmless

    def log_message(self, fmt, *args):
        # Only log RPC calls and errors; suppress noisy static asset GETs
        path = getattr(self, 'path', '')
        if path.startswith('/.well-known/'):
            return
        code = ''
        for arg in args:
            if isinstance(arg, HTTPStatus):
                code = str(arg.value)
                break
            text = str(arg)
            if len(text) == 3 and text.isdigit():
                code = text
        if '/rpc' in path or '/downloads/' in path or '/zip' in path or '/delete' in path or code.startswith(('4', '5')):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    os.chdir(STATIC_ROOT)
    print(f'CloudSeed dev server -> http://localhost:{PORT}')
    print(f'Proxying RPC  ->  {TRANSMISSION_RPC}')
    print(f'Serving files ->  {STATIC_ROOT}')
    print('ZIP route     ->  GET /zip?path=FolderName')
    print('Press Ctrl+C to stop.\n')
    with http.server.ThreadingHTTPServer(('', PORT), ProxyHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nStopped.')
