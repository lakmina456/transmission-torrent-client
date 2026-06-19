"""
dev-proxy.py — local development proxy for CloudSeed
- Serves static files from web/public_html/
- Proxies POST /rpc to Transmission
- Serves GET /downloads/* directly from Transmission's download directory
- Handles Range requests so IDM / partial downloads work

Usage:  python dev-proxy.py
Then open: http://localhost:8080
"""
import http.server
import json
import mimetypes
import os
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


class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_ROOT, **kwargs)

    # ── GET /downloads/* → serve from Transmission download dir ──────────
    def do_GET(self):
        if self.path.startswith('/downloads/'):
            self._serve_download()
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

    # ── POST /rpc → proxy to Transmission ─────────────────────────────────
    def do_POST(self):
        if self.path not in ('/rpc', '/transmission/rpc'):
            self.send_error(404)
            return

        global _session_id
        length = int(self.headers.get('Content-Length', 0))
        body   = self.rfile.read(length) if length else b'{}'

        headers = {
            'Content-Type': 'application/json',
            'X-Transmission-Session-Id': self.headers.get('X-Transmission-Session-Id', _session_id),
        }

        req = urllib.request.Request(TRANSMISSION_RPC, data=body, headers=headers, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
                sid  = resp.headers.get('X-Transmission-Session-Id', '')
                if sid:
                    _session_id = sid
                self._send_rpc_response(resp.status, sid, data)
        except urllib.error.HTTPError as e:
            data = e.read()
            sid  = e.headers.get('X-Transmission-Session-Id', '')
            if sid:
                _session_id = sid
            self._send_rpc_response(e.code, sid, data)
        except Exception as e:
            msg = f'Proxy error: {e}'.encode()
            self._send_rpc_response(502, '', msg, ct='text/plain')

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
        code = args[1] if len(args) > 1 else ''
        path = args[0] if args else ''
        if '/rpc' in path or '/downloads/' in path or code.startswith(('4', '5')):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    os.chdir(STATIC_ROOT)
    print(f'CloudSeed dev server -> http://localhost:{PORT}')
    print(f'Proxying RPC  ->  {TRANSMISSION_RPC}')
    print(f'Serving files ->  {STATIC_ROOT}')
    print('Press Ctrl+C to stop.\n')
    with http.server.ThreadingHTTPServer(('', PORT), ProxyHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nStopped.')
