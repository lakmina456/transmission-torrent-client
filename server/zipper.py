#!/usr/bin/env python3
"""
CloudSeed ZIP streaming service.
Streams a folder from the downloads directory as a ZIP archive.

Usage:  GET /zip?path=FolderName
        GET /health
"""
import io
import os
import zipfile

from flask import Flask, Response, abort, request

app = Flask(__name__)

DOWNLOADS_ROOT = os.environ.get('DOWNLOADS_ROOT', '/var/lib/transmission-daemon/downloads')


def safe_path(rel):
    """Resolve and verify the path stays inside DOWNLOADS_ROOT."""
    real_root = os.path.realpath(DOWNLOADS_ROOT)
    abs_path = os.path.realpath(os.path.join(real_root, rel.lstrip('/')))
    if not abs_path.startswith(real_root + os.sep) and abs_path != real_root:
        return None
    return abs_path


def stream_zip(folder):
    """Generator: yield ZIP bytes in chunks."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode='w', compression=zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
        for root, _dirs, files in os.walk(folder):
            for fname in files:
                full = os.path.join(root, fname)
                arcname = os.path.relpath(full, os.path.dirname(folder))
                zf.write(full, arcname)
                buf.seek(0)
                chunk = buf.read()
                if chunk:
                    yield chunk
                buf.seek(0)
                buf.truncate()
    buf.seek(0)
    tail = buf.read()
    if tail:
        yield tail


@app.route('/zip')
def download_zip():
    rel = request.args.get('path', '').strip()
    if not rel:
        abort(400, 'Missing path parameter')

    abs_path = safe_path(rel)
    if abs_path is None:
        abort(403, 'Path traversal detected')
    if not os.path.isdir(abs_path):
        abort(404, f'Folder not found: {rel}')

    folder_name = os.path.basename(abs_path.rstrip('/'))
    zip_name = f'{folder_name}.zip'

    return Response(
        stream_zip(abs_path),
        mimetype='application/zip',
        headers={
            'Content-Disposition': f'attachment; filename="{zip_name}"',
            'X-Accel-Buffering': 'no',
        },
    )


@app.route('/health')
def health():
    return {'status': 'ok', 'downloads_root': DOWNLOADS_ROOT}


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='127.0.0.1', port=port, threaded=True)
