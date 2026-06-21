#!/usr/bin/env python3
"""
CloudSeed ZIP streaming service.
Streams a folder from the downloads directory as a ZIP archive.
Permanently deletes files under the downloads root on request.

Usage:  GET  /zip?path=FolderName
        POST /delete          JSON body: {"paths": ["Folder/file.mkv", ...]}
        GET  /health
"""
import io
import os
import shutil
import zipfile

from flask import Flask, Response, abort, jsonify, request

app = Flask(__name__)

DOWNLOADS_ROOT = os.environ.get('DOWNLOADS_ROOT', '/var/lib/transmission-daemon/downloads')


def safe_path(rel):
    """Resolve and verify the path stays inside DOWNLOADS_ROOT."""
    real_root = os.path.realpath(DOWNLOADS_ROOT)
    abs_path = os.path.realpath(os.path.join(real_root, rel.lstrip('/\\')))
    if not abs_path.startswith(real_root + os.sep) and abs_path != real_root:
        return None
    return abs_path


def prune_empty_dirs(path, root):
    """Remove empty parent directories up to root (not including root)."""
    root = os.path.realpath(root)
    current = os.path.dirname(os.path.realpath(path))
    while current.startswith(root + os.sep):
        try:
            os.rmdir(current)
        except OSError:
            break
        current = os.path.dirname(current)


def remove_download_path(rel):
    """Permanently delete a file (and incomplete copy) under DOWNLOADS_ROOT."""
    rel = (rel or '').strip().lstrip('/\\')
    if not rel:
        return 'error', 'empty path'

    real_root = os.path.realpath(DOWNLOADS_ROOT)
    removed_any = False
    last_error = None

    for candidate in (rel, os.path.join('.incomplete', rel)):
        abs_path = safe_path(candidate)
        if abs_path is None:
            last_error = 'invalid path'
            continue
        if not os.path.lexists(abs_path):
            continue
        try:
            if os.path.isdir(abs_path):
                shutil.rmtree(abs_path)
            else:
                os.remove(abs_path)
            prune_empty_dirs(abs_path, real_root)
            removed_any = True
        except OSError as exc:
            last_error = str(exc)

    if removed_any:
        return 'deleted', None
    if last_error:
        return 'error', last_error
    return 'missing', None


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


@app.route('/delete', methods=['POST'])
def delete_files():
    payload = request.get_json(silent=True) or {}
    paths = payload.get('paths')
    if not isinstance(paths, list) or not paths:
        abort(400, 'Missing paths array')

    deleted = []
    missing = []
    errors = []

    for rel in paths:
        rel_str = str(rel).strip()
        if not rel_str:
            continue
        status, err = remove_download_path(rel_str)
        if status == 'deleted':
            deleted.append(rel_str)
        elif status == 'missing':
            missing.append(rel_str)
        else:
            errors.append({'path': rel_str, 'error': err or 'delete failed'})

    status = 200 if not errors else 207
    return jsonify({
        'deleted': deleted,
        'missing': missing,
        'errors': errors,
    }), status


@app.route('/health')
def health():
    return {'status': 'ok', 'downloads_root': DOWNLOADS_ROOT}


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='127.0.0.1', port=port, threaded=True)
