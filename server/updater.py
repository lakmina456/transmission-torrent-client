#!/usr/bin/env python3
"""
CloudSeed updater API — version info, update check, and deploy trigger.

Endpoints (proxied via nginx at /api/):
  GET  /health
  GET  /api/version
  GET  /api/update/check
  GET  /api/update/status
  POST /api/update          Requires header: X-Update-Token
"""
import hmac
import json
import os
import subprocess
import threading
import time

from flask import Flask, abort, jsonify, request

app = Flask(__name__)

UPDATE_TOKEN = os.environ.get('UPDATE_TOKEN', '')
DEPLOY_SCRIPT = os.environ.get('DEPLOY_SCRIPT', '/opt/cloudseed/deploy.sh')
WEB_ROOT = os.environ.get('CLOUDSEED_WEB', '/var/lib/transmission-daemon/info/web')
VERSION_FILE = os.path.join(WEB_ROOT, 'version.json')
DEPLOY_TIMEOUT = int(os.environ.get('DEPLOY_TIMEOUT', '600'))
CHECK_TIMEOUT = int(os.environ.get('CHECK_TIMEOUT', '120'))

_deploy_lock = threading.Lock()
_deploy_status = {
    'running': False,
    'startedAt': None,
    'finishedAt': None,
    'exitCode': None,
    'log': '',
    'error': None,
}


def _token_ok():
    if not UPDATE_TOKEN:
        return False
    supplied = request.headers.get('X-Update-Token', '')
    if not supplied:
        return False
    return hmac.compare_digest(supplied.encode(), UPDATE_TOKEN.encode())


def _read_version():
    if os.path.isfile(VERSION_FILE):
        with open(VERSION_FILE, encoding='utf-8') as fh:
            return json.load(fh)
    return {
        'commit': None,
        'commitFull': None,
        'branch': None,
        'updatedAt': None,
        'message': 'No version file yet — run deploy once from the VPS',
    }


@app.route('/health')
def health():
    return {
        'status': 'ok',
        'service': 'cloudseed-updater',
        'updateConfigured': bool(UPDATE_TOKEN),
    }


@app.route('/api/version')
def version():
    return jsonify(_read_version())


@app.route('/api/update/check')
def update_check():
    try:
        result = subprocess.run(
            ['sudo', '-n', DEPLOY_SCRIPT, 'check'],
            capture_output=True,
            text=True,
            timeout=CHECK_TIMEOUT,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Update check timed out'}), 504
    except FileNotFoundError:
        return jsonify({'error': 'Deploy script not found on server'}), 500

    if result.returncode != 0:
        msg = (result.stderr or result.stdout or 'check failed').strip()
        return jsonify({'error': msg}), 500

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid check output from deploy script'}), 500

    installed = _read_version()
    payload['installed'] = installed
    return jsonify(payload)


def _run_deploy():
    global _deploy_status
    _deploy_status = {
        'running': True,
        'startedAt': time.time(),
        'finishedAt': None,
        'exitCode': None,
        'log': '',
        'error': None,
    }
    try:
        result = subprocess.run(
            ['sudo', '-n', DEPLOY_SCRIPT],
            capture_output=True,
            text=True,
            timeout=DEPLOY_TIMEOUT,
            check=False,
        )
        _deploy_status['log'] = ((result.stdout or '') + (result.stderr or '')).strip()
        _deploy_status['exitCode'] = result.returncode
        if result.returncode != 0:
            _deploy_status['error'] = 'Deploy script failed'
    except subprocess.TimeoutExpired:
        _deploy_status['error'] = 'Deploy timed out'
        _deploy_status['exitCode'] = -1
    except Exception as exc:  # noqa: BLE001 — surface to status endpoint
        _deploy_status['error'] = str(exc)
        _deploy_status['exitCode'] = -1
    finally:
        _deploy_status['running'] = False
        _deploy_status['finishedAt'] = time.time()
        _deploy_lock.release()


@app.route('/api/update', methods=['POST'])
def update():
    if not UPDATE_TOKEN:
        abort(
            503,
            'Update token not configured on server. Set UPDATE_TOKEN in /etc/cloudseed/updater.env',
        )
    if not _token_ok():
        abort(403, 'Invalid or missing X-Update-Token header')

    if not _deploy_lock.acquire(blocking=False):
        return jsonify({'error': 'Update already in progress', 'status': _deploy_status}), 409

    threading.Thread(target=_run_deploy, daemon=True).start()
    return jsonify({'ok': True, 'message': 'Update started'})


@app.route('/api/update/status')
def update_status():
    return jsonify(_deploy_status)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5002))
    app.run(host='127.0.0.1', port=port, threaded=True)
