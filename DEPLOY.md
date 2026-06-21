# CloudSeed — Ubuntu VPS Deployment Guide

### Oracle Cloud Free Tier · 1 GB RAM · Ubuntu 22.04

---

## What You're Deploying


| Component               | Role                                                                    |
| ----------------------- | ----------------------------------------------------------------------- |
| **Transmission-daemon** | BitTorrent engine, runs headless, exposes JSON-RPC on port 9091         |
| **nginx**               | Reverse proxy — serves the web UI, proxies RPC, serves downloaded files |
| **CloudSeed UI**        | The new Seedr-style frontend (your `web/public_html/` files)            |
| **zipper.py**           | Flask micro-service (port 5001) — streams folders as ZIP; permanent file delete via `POST /delete` |


---

## Prerequisites

- Oracle Cloud free-tier VM running **Ubuntu 22.04**
- SSH access to the VM
- A domain name **or** just the public IP (the guide works with IP only)
- Source repo (public): [github.com/lakmina456/transmission-torrent-client](https://github.com/lakmina456/transmission-torrent-client) — CloudSeed UI, `zipper.py`, and deploy scripts (default branch: `develop`)

---

## Step 1 — First Login & System Update

```bash
ssh ubuntu@92.4.71.82

sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget unzip ufw git
```

---

## Step 2 — Open Firewall Ports

### Oracle Cloud Security List (do this in the web console)

1. Go to **Networking → Virtual Cloud Networks → your VCN → Security Lists**
2. Add **Ingress Rules**:


| Protocol | Port | Source CIDR | Note             |
| -------- | ---- | ----------- | ---------------- |
| TCP      | 22   | 0.0.0.0/0   | SSH              |
| TCP      | 80   | 0.0.0.0/0   | HTTP             |
| TCP      | 443  | 0.0.0.0/0   | HTTPS (optional) |


> Port 9091 (Transmission) and 5001 (zipper) stay **closed** — nginx proxies them internally.

### Ubuntu UFW firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

---

## Step 3 — Install Transmission

```bash
sudo apt install -y transmission-daemon

# Stop it before editing config
sudo systemctl stop transmission-daemon
```

### Configure Transmission

```bash
sudo nano /etc/transmission-daemon/settings.json
```

Find and set these values (leave everything else as-is):

```json
{
  "rpc-enabled": true,
  "rpc-port": 9091,
  "rpc-whitelist-enabled": false,
  "rpc-authentication-required": false,
  "rpc-bind-address": "127.0.0.1",
  "download-dir": "/var/lib/transmission-daemon/downloads",
  "incomplete-dir": "/var/lib/transmission-daemon/downloads/.incomplete",
  "incomplete-dir-enabled": true,
  "umask": 2,
  "ratio-limit-enabled": false,
  "speed-limit-down-enabled": false,
  "speed-limit-up-enabled": false,
  "peer-port": 51413,
  "peer-port-random-on-start": false
}
```

> **Security note:** `rpc-bind-address: 127.0.0.1` means Transmission only listens locally — nginx handles auth.

### Set permissions and start

```bash
sudo mkdir -p /var/lib/transmission-daemon/downloads/.incomplete
sudo chown -R debian-transmission:debian-transmission /var/lib/transmission-daemon/downloads
sudo chmod 775 /var/lib/transmission-daemon/downloads
sudo chmod 775 /var/lib/transmission-daemon/downloads/.incomplete

sudo systemctl enable transmission-daemon
sudo systemctl start transmission-daemon
sudo systemctl status transmission-daemon   # should show "active (running)"
```

### Test Transmission RPC locally

```bash
curl -s -X POST http://127.0.0.1:9091/transmission/rpc \
  -H "Content-Type: application/json" \
  -d '{"method":"session-get","arguments":{}}' 2>&1 | head -5
# First call returns 409 (CSRF) — that's normal
```

---

## Step 4 — Install nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

---

## Step 5 — Deploy CloudSeed Web UI

All commands below run **on the VPS** after you SSH in. Files come from GitHub — no `scp` from your PC required.

### Clone the repo from GitHub

```bash
sudo mkdir -p /opt/cloudseed
sudo git clone -b develop https://github.com/lakmina456/transmission-torrent-client.git /opt/cloudseed/src
```

> The clone lives at `/opt/cloudseed/src/` and is reused later for UI updates (Step 11).

To use a different branch: (do not do this)

```bash
sudo git clone -b YOUR_BRANCH https://github.com/lakmina456/transmission-torrent-client.git /opt/cloudseed/src
```

### Install the web UI

```bash
# Web UI → Transmission's web root
sudo mkdir -p /var/lib/transmission-daemon/info/web
sudo cp -r /opt/cloudseed/src/web/public_html/* /var/lib/transmission-daemon/info/web/
sudo chown -R debian-transmission:debian-transmission /var/lib/transmission-daemon/info/web/

# Verify
sudo ls -la /var/lib/transmission-daemon/info/web/
# Should show: index.html  cloudseed.css  cloudseed.js  config.js  images/
```

Tell Transmission where the CloudSeed files are (required — it does not use this path by default):

```bash
sudo mkdir -p /etc/systemd/system/transmission-daemon.service.d
sudo tee /etc/systemd/system/transmission-daemon.service.d/cloudseed-web.conf <<'EOF'
[Service]
Environment=TRANSMISSION_WEB_HOME=/var/lib/transmission-daemon/info/web
EOF

sudo systemctl daemon-reload
sudo systemctl restart transmission-daemon
```

### Edit config.js for production

```bash
sudo nano /var/lib/transmission-daemon/info/web/config.js
```

```js
window.APP_CONFIG = {
  rpcPath:            '/transmission/rpc',
  fileServerBase:     '/downloads',
  zipServerBase:      '/zip',
  deleteServerBase:   '/delete',
  pollInterval:       3000,
  totalStorageGB:     44,          // Oracle free tier has ~46 GB — leave 2 GB headroom
  appName:            'CloudSeed',
  autoPasteMagnet:    true,
  zipWarnThresholdGB: 4,
  updateApiBase:      '/api',
};
```

Save in nano: **Ctrl+O**, Enter, **Ctrl+X**.

---

## Step 6 — Deploy the ZIP Streaming Service

### Install Python dependencies

Use the Debian package (do **not** use `pip3 install` on Ubuntu 22.04+ — PEP 668 blocks system-wide pip):

```bash
sudo apt install -y python3-flask
```

### Place the script

```bash
sudo mkdir -p /opt/cloudseed
sudo cp /opt/cloudseed/src/server/zipper.py /opt/cloudseed/zipper.py
sudo chmod +x /opt/cloudseed/zipper.py
```

### Create systemd service

```bash
sudo nano /etc/systemd/system/cloudseed-zipper.service
```

```ini
[Unit]
Description=CloudSeed ZIP streaming service
After=network.target

[Service]
ExecStart=/usr/bin/python3 /opt/cloudseed/zipper.py
Restart=always
RestartSec=5
User=www-data
Group=www-data
Environment=DOWNLOADS_ROOT=/var/lib/transmission-daemon/downloads
Environment=PORT=5001

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable cloudseed-zipper
sudo systemctl start cloudseed-zipper
sudo systemctl status cloudseed-zipper   # should show "active (running)"

# Test it
curl http://127.0.0.1:5001/health
# Expected: {"status": "ok", "downloads_root": "/var/lib/transmission-daemon/downloads"}
```

---

## Step 7 — Configure nginx

### Set up HTTP basic auth (password protection)

```bash
sudo apt install -y apache2-utils

# Replace 'admin' with your preferred username
sudo htpasswd -c /etc/nginx/.htpasswd admin
# Enter a strong password when prompted (you choose it — not your SSH password)
```

### Write the nginx site config

```bash
sudo nano /etc/nginx/sites-available/cloudseed
```

```nginx
server {
    listen 80;
    server_name _;          # accepts any hostname/IP — change to your domain if you have one

    # ── Auth ─────────────────────────────────────────────────────────────
    auth_basic           "CloudSeed";
    auth_basic_user_file /etc/nginx/.htpasswd;

    # ── Transmission RPC + Web UI ─────────────────────────────────────────
    location /transmission/ {
        proxy_pass         http://127.0.0.1:9091/transmission/;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   Authorization "";
        proxy_read_timeout 60s;
    }

    # ── HTTP file downloads — single files, IDM-compatible ────────────────
    location /downloads/ {
        alias       /var/lib/transmission-daemon/downloads/;
        autoindex   off;

        # Proper MIME types so IDM knows what it's getting
        include     /etc/nginx/mime.types;
        default_type application/octet-stream;

        # Range requests — required for IDM resume support
        add_header  Accept-Ranges bytes;

        # Force download (not inline browser preview)
        add_header  Content-Disposition 'attachment';
    }

    # ── ZIP streaming — folder torrents ───────────────────────────────────
    location /zip {
        proxy_pass         http://127.0.0.1:5001/zip;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;

        # Critical: must stream, NOT buffer the entire ZIP before sending
        proxy_buffering    off;
        proxy_read_timeout 3600s;   # allow up to 1 hour for huge ZIPs
        add_header         X-Accel-Buffering no;
    }

    # ── Permanent file delete (CloudSeed file panel) ──────────────────────
    location = /delete {
        proxy_pass         http://127.0.0.1:5001/delete;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_read_timeout 60s;
    }

    # ── App updates API (Menu → Check for updates) ─────────────────────────
    location /api/ {
        proxy_pass         http://127.0.0.1:5002/api/;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_read_timeout 120s;
    }

    # ── Health check (no auth) ────────────────────────────────────────────
    location /health {
        auth_basic off;
        return 200 "ok\n";
        add_header Content-Type text/plain;
    }
}
```

### Enable the site

```bash
# Disable the default nginx welcome page
sudo rm -f /etc/nginx/sites-enabled/default

# Enable CloudSeed
sudo ln -s /etc/nginx/sites-available/cloudseed /etc/nginx/sites-enabled/cloudseed

# Test config
sudo nginx -t
# Expected: "syntax is ok" and "test is successful"

# Reload nginx
sudo systemctl reload nginx
```

---

## Step 8 — Fix File Permissions

Transmission downloads as `debian-transmission`, but nginx and zipper.py run as `www-data`. Both need read access to the downloads folder; zipper also needs write access for permanent file delete.

```bash
# Add www-data to the transmission group
sudo usermod -aG debian-transmission www-data

# Make downloads readable by the group
sudo chmod -R 775 /var/lib/transmission-daemon/downloads
sudo chmod g+s /var/lib/transmission-daemon/downloads   # new files inherit group

# Restart nginx to pick up group membership
sudo systemctl restart nginx
```

---

## Step 9 — Access the UI

Open your browser:

```
http://92.4.71.82/transmission/web/
```

Enter the username/password you set in Step 7.

You should see the CloudSeed UI with:

- ✅ Green connection dot (top right)
- ✅ Storage meter showing used/free space
- ✅ "No torrents here" empty state

---

## Step 10 — Test Everything

### Add a test torrent

Paste any magnet link into the input box → click **Add**.
Watch the card appear with a live progress bar.

### Test file download

Once complete, click **Download** on the card.

- Single file → direct `.mkv` / `.mp4` link (IDM-compatible)
- Folder → ZIP download bar + individual file links

### Test the ZIP service manually

```bash
# After a folder torrent completes, replace "FolderName" with the actual folder
curl -u admin:yourpassword \
  "http://92.4.71.82/zip?path=FolderName" \
  -o test.zip -v
```

---

## Useful Commands (Day-to-Day)

```bash
# View Transmission logs
sudo journalctl -u transmission-daemon -f

# View nginx access/error logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# View zipper logs
sudo journalctl -u cloudseed-zipper -f

# Restart everything
sudo systemctl restart transmission-daemon cloudseed-zipper nginx

# Check all services at once
sudo systemctl status transmission-daemon cloudseed-zipper nginx

# Check disk space
df -h /var/lib/transmission-daemon/downloads

# List downloads folder
ls -lh /var/lib/transmission-daemon/downloads/

# Delete a torrent's files manually (if not done via UI)
sudo rm -rf "/var/lib/transmission-daemon/downloads/FolderName"
```

---

## Troubleshooting

### Login prompt keeps coming back (username/password loop)

The browser is sending credentials, but nginx returns **401 Unauthorized** — wrong user/password, or no `.htpasswd` file.

**On the VPS**, reset the password (pick something simple to test, e.g. `CloudSeed123`):

```bash
# Create or update user 'admin' (omit -c if the file already exists and you only want to change the password)
sudo htpasswd /etc/nginx/.htpasswd admin

# If the file is missing, create it instead:
# sudo htpasswd -c /etc/nginx/.htpasswd admin

sudo chmod 640 /etc/nginx/.htpasswd
sudo chown root:www-data /etc/nginx/.htpasswd
sudo nginx -t && sudo systemctl reload nginx
```

Verify login works (replace `admin` and password). Use **GET** — `curl -I` sends HEAD, which Transmission rejects:

```bash
curl -s -u admin:CloudSeed123 http://127.0.0.1/transmission/web/ | head -5
```

You want HTML starting with `<!DOCTYPE` or `<html` — not `401 Unauthorized`.

**In the browser:**

- Use username `**admin`** exactly (case-sensitive), unless you chose a different name in `htpasswd`.
- This is **not** your Ubuntu SSH password.
- Try a **private/incognito** window so old wrong passwords are not cached.
- If it still loops, click **Cancel**, close the tab, open a new tab, and try again.

### 401 after login (nginx page or "401: Unauthorized")

nginx validated your password, but forwarded the `Authorization` header to Transmission. If Transmission RPC auth is enabled, it rejects nginx credentials.

**Fix 1 — strip the header in nginx** (add inside `location /transmission/`):

```nginx
proxy_set_header Authorization "";
```

Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

**Fix 2 — disable Transmission RPC password** (recommended when nginx handles auth):

```bash
sudo systemctl stop transmission-daemon
sudo nano /etc/transmission-daemon/settings.json
```

Set `"rpc-authentication-required": false`, save, then:

```bash
sudo systemctl start transmission-daemon
```

**Fix 3 — point Transmission at CloudSeed files** (if you see the old Transmission UI or "Couldn't find web interface files"):

```bash
sudo tee /etc/systemd/system/transmission-daemon.service.d/cloudseed-web.conf <<'EOF'
[Service]
Environment=TRANSMISSION_WEB_HOME=/var/lib/transmission-daemon/info/web
EOF
sudo systemctl daemon-reload
sudo systemctl restart transmission-daemon
```

Test with GET (not `curl -I`):

```bash
curl -s -u admin:YOUR_PASSWORD http://127.0.0.1/transmission/web/ | head -5
```

### Torrent error: Permission denied on `.incomplete`

Example: `Couldn't get '/var/lib/transmission-daemon/.incomplete/...' Permission denied (13)`

Transmission runs as `debian-transmission` and must own the download and incomplete folders.

```bash
sudo systemctl stop transmission-daemon

# Create both possible incomplete locations
sudo mkdir -p /var/lib/transmission-daemon/downloads/.incomplete
sudo mkdir -p /var/lib/transmission-daemon/.incomplete

# Fix ownership
sudo chown -R debian-transmission:debian-transmission /var/lib/transmission-daemon/downloads
sudo chown -R debian-transmission:debian-transmission /var/lib/transmission-daemon/.incomplete
sudo chmod -R 775 /var/lib/transmission-daemon/downloads
sudo chmod 775 /var/lib/transmission-daemon/.incomplete

# Align settings (stop daemon before editing)
sudo nano /etc/transmission-daemon/settings.json
```

Set:

```json
"download-dir": "/var/lib/transmission-daemon/downloads",
"incomplete-dir": "/var/lib/transmission-daemon/downloads/.incomplete",
"incomplete-dir-enabled": true,
```

```bash
sudo systemctl start transmission-daemon
```

Remove the broken torrent in the UI, then add it again. Or resume after fixing permissions.

Verify Transmission can write:

```bash
sudo -u debian-transmission touch /var/lib/transmission-daemon/downloads/.incomplete/test-write
sudo -u debian-transmission rm /var/lib/transmission-daemon/downloads/.incomplete/test-write
```

### "No data found" / remove torrent and re-add

Transmission still has the torrent in its database, but **no files exist on disk** (common after a failed download or permission error).

**In CloudSeed:** delete the torrent (enable **delete local data** if offered), then add the magnet again and start.

**On the VPS**, clean partial leftovers and confirm the download path:

```bash
# See what Transmission is configured to use
grep -E 'download-dir|incomplete-dir' /etc/transmission-daemon/settings.json

# List partial downloads (folder names vary)
sudo ls -la /var/lib/transmission-daemon/downloads/
sudo ls -la /var/lib/transmission-daemon/.incomplete/ 2>/dev/null || true

# Optional: remove stale partial folder for that torrent (replace folder name)
# sudo rm -rf "/var/lib/transmission-daemon/downloads/.incomplete/From.S04E07.1080p.x265-ELITE"
# sudo rm -rf "/var/lib/transmission-daemon/.incomplete/From.S04E07.1080p.x265-ELITE"

sudo systemctl restart transmission-daemon
```

Then re-add the torrent in the UI. A fresh add after permissions are fixed should download normally.

### Green dot is red / "Disconnected"

```bash
# Check Transmission is running
sudo systemctl status transmission-daemon

# Test RPC from inside the VPS
curl -s http://127.0.0.1:9091/transmission/rpc
# If you see 409 — Transmission is running fine (CSRF token response)

# Check nginx is proxying correctly
curl -u admin:pass http://92.4.71.82/transmission/rpc
```

### Storage meter shows wrong value

Edit `config.js` and set `totalStorageGB` to match your actual disk:

```bash
df -h /var/lib/transmission-daemon/downloads
# Look at the "Size" column
```

### Download button says "File not found"

```bash
# Check the file actually exists
ls /var/lib/transmission-daemon/downloads/

# Check nginx /downloads/ permissions
sudo -u www-data ls /var/lib/transmission-daemon/downloads/
# If this gives "Permission denied" → re-run Step 8
```

### ZIP download fails immediately

```bash
# Check zipper service is running
sudo systemctl status cloudseed-zipper
curl http://127.0.0.1:5001/health

# Check zipper can read the downloads folder
sudo -u www-data ls /var/lib/transmission-daemon/downloads/
```

### Transmission won't start after editing settings.json

```bash
# Validate JSON syntax
python3 -m json.tool /etc/transmission-daemon/settings.json
# Fixes any syntax errors it reports, then:
sudo systemctl start transmission-daemon
```

### Out of memory (1 GB RAM is tight)

```bash
# Add 1 GB swap to help
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Check memory
free -h
```

---

## Optional — Add HTTPS with Let's Encrypt

Only do this if you have a **real domain name** pointing to your VPS IP.

```bash
sudo apt install -y certbot python3-certbot-nginx

# Replace with your actual domain
sudo certbot --nginx -d yourdomain.com

# Auto-renew (certbot adds this automatically, but verify)
sudo systemctl status certbot.timer
```

---

## Step 11 — Git-based updates (Menu → Check for updates)

This enables the **Updates** tab in Settings: check GitHub for new commits and deploy from the UI.

Repo: **[https://github.com/lakmina456/transmission-torrent-client](https://github.com/lakmina456/transmission-torrent-client)** (default branch: `develop`)

### 11a — Repo on the VPS

If you followed **Step 5**, the repo is already at `/opt/cloudseed/src` — skip to **11b**.

> **`fatal: destination path already exists`** — the clone is already there; do **not** clone again. Use `sudo git -C /opt/cloudseed/src pull origin develop` if you need the latest files before Step 11b.

> **`dubious ownership`** when running `git` as `ubuntu` — the repo was cloned with `sudo` (owned by root). Use `sudo git -C /opt/cloudseed/src …` for manual git commands, or run once: `git config --global --add safe.directory /opt/cloudseed/src`.

Otherwise clone it now:

**Option A — HTTPS (simplest; repo is public)**

```bash
sudo mkdir -p /opt/cloudseed
sudo git clone -b develop https://github.com/lakmina456/transmission-torrent-client.git /opt/cloudseed/src
```

**Option B — Deploy key over SSH (recommended for unattended `git pull` in the updater)**

On the VPS:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/cloudseed_deploy -N ""
cat ~/.ssh/cloudseed_deploy.pub
```

In GitHub: **lakmina456/transmission-torrent-client → Settings → Deploy keys → Add deploy key** (read-only, no write access).

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-cloudseed
  HostName github.com
  User git
  IdentityFile ~/.ssh/cloudseed_deploy
  IdentitiesOnly yes
EOF

sudo mkdir -p /opt/cloudseed
sudo git clone -b develop git@github-cloudseed:lakmina456/transmission-torrent-client.git /opt/cloudseed/src
```

Set the branch the updater tracks (must match what you cloned). Create `/etc/cloudseed` first — `cp` fails if the directory does not exist:

```bash
sudo mkdir -p /etc/cloudseed
sudo cp /opt/cloudseed/src/server/deploy.env.example /etc/cloudseed/deploy.env
echo 'CLOUDSEED_BRANCH=develop' | sudo tee -a /etc/cloudseed/deploy.env
sudo chmod 600 /etc/cloudseed/deploy.env
```

> `deploy.sh` defaults to branch **`main`** if `CLOUDSEED_BRANCH` is unset — set **`develop`** here (or whatever branch you push to on GitHub).

### 11b — Install deploy + updater scripts

```bash
sudo mkdir -p /opt/cloudseed /etc/cloudseed
sudo cp /opt/cloudseed/src/server/deploy.sh /opt/cloudseed/deploy.sh
sudo cp /opt/cloudseed/src/server/updater.py /opt/cloudseed/updater.py
sudo chmod +x /opt/cloudseed/deploy.sh /opt/cloudseed/updater.py
```

### 11c — Secrets (required — do NOT commit these)

Generate an update token:

```bash
openssl rand -hex 32
```

Create the updater environment file on the VPS:

```bash
sudo cp /opt/cloudseed/src/server/updater.env.example /etc/cloudseed/updater.env
sudo nano /etc/cloudseed/updater.env
```

Set `UPDATE_TOKEN` to the value from `openssl rand -hex 32`. Save this token somewhere safe (password manager) — you enter it in the UI when clicking **Update now**.

```bash
sudo chmod 600 /etc/cloudseed/updater.env
sudo chown root:root /etc/cloudseed/updater.env
```

Optional path overrides: copy `server/deploy.env.example` → `/etc/cloudseed/deploy.env`.


| File on VPS                        | Purpose                                             | In git?            |
| ---------------------------------- | --------------------------------------------------- | ------------------ |
| `/etc/cloudseed/updater.env`       | `UPDATE_TOKEN` and service config                   | **Never**          |
| `/etc/cloudseed/deploy.env`        | Optional repo paths / branch                        | **Never**          |
| `web/public_html/config.js` on VPS | Production RPC paths, storage — preserved on update | **Never** (on VPS) |


### 11d — Sudoers (www-data may only run deploy.sh)

```bash
sudo cp /opt/cloudseed/src/server/cloudseed-updater.sudoers /etc/sudoers.d/cloudseed-updater
sudo chmod 440 /etc/sudoers.d/cloudseed-updater
sudo visudo -c
```

### 11e — Updater systemd service

The updater runs as `www-data` and calls `sudo /opt/cloudseed/deploy.sh`. Do **not** set `NoNewPrivileges=true` on this unit — it blocks sudo and breaks **Check for updates** (Remote status **UNAVAILABLE**).

```bash
sudo cp /opt/cloudseed/src/server/cloudseed-updater.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable cloudseed-updater
sudo systemctl start cloudseed-updater
sudo systemctl status cloudseed-updater

curl -s http://127.0.0.1:5002/health
# Expected: {"status":"ok","service":"cloudseed-updater","updateConfigured":true}

curl -s http://127.0.0.1:5002/api/update/check
# Expected: JSON with current, remote, branch — not a sudo error
```

**Already deployed with an older unit file?** Remove the blocking line, then restart:

```bash
sudo sed -i '/NoNewPrivileges=true/d' /etc/systemd/system/cloudseed-updater.service
sudo systemctl daemon-reload
sudo systemctl restart cloudseed-updater
systemctl show cloudseed-updater -p NoNewPrivileges   # should show: NoNewPrivileges=no
```

### 11f — First deploy + nginx reload

If you did not set `/etc/cloudseed/deploy.env` in **11a**, do it now (see **11a** for `CLOUDSEED_BRANCH=develop`).

Then deploy:

```bash
sudo /opt/cloudseed/deploy.sh
sudo nginx -t && sudo systemctl reload nginx
```

### Using updates from the UI

1. Push changes to the `develop` branch on GitHub (or the branch set in `/etc/cloudseed/deploy.env`).
2. Open CloudSeed → **Menu** → **Check for updates**.
3. Click **Check for updates**.
4. Enter your `UPDATE_TOKEN` and click **Update now**.
5. Page reloads when deploy finishes.

**Security layers:** nginx basic auth (whole site) + `X-Update-Token` header (deploy only) + sudoers limited to `/opt/cloudseed/deploy.sh`.

**Local dev:** the Updates tab shows “service unavailable” — expected without the updater on `:5002`.

**Manual deploy (no UI):** `sudo /opt/cloudseed/deploy.sh` — works even when the updater service is misconfigured.

### Updates: Remote status UNAVAILABLE (sudo / no new privileges)

UI or `curl` shows:

```text
sudo: The "no new privileges" flag is set, which prevents sudo from running as root.
```

**Cause:** `cloudseed-updater` has `NoNewPrivileges=true` in its systemd unit (see **11e** fix).

**Also verify sudoers:**

```bash
sudo cat /etc/sudoers.d/cloudseed-updater
sudo -u www-data sudo -n /opt/cloudseed/deploy.sh check
```

---

## File Locations Reference


| What                 | Path                                                 |
| -------------------- | ---------------------------------------------------- |
| CloudSeed UI files   | `/var/lib/transmission-daemon/info/web/`             |
| Downloaded torrents  | `/var/lib/transmission-daemon/downloads/`            |
| Transmission config  | `/etc/transmission-daemon/settings.json`             |
| nginx site config    | `/etc/nginx/sites-available/cloudseed`               |
| nginx auth file      | `/etc/nginx/.htpasswd`                               |
| ZIP service script   | `/opt/cloudseed/zipper.py`                           |
| ZIP systemd unit     | `/etc/systemd/system/cloudseed-zipper.service`       |
| Git clone (updates)  | `/opt/cloudseed/src/`                                |
| Deploy script        | `/opt/cloudseed/deploy.sh`                           |
| Updater API script   | `/opt/cloudseed/updater.py`                          |
| Updater secrets      | `/etc/cloudseed/updater.env`                         |
| Updater systemd unit | `/etc/systemd/system/cloudseed-updater.service`      |
| Installed version    | `/var/lib/transmission-daemon/info/web/version.json` |


---

## Architecture Summary

```
Browser
  │
  ▼
nginx :80  (auth gating)
  ├── /transmission/web/*  →  static files from Transmission web root
  ├── /transmission/rpc    →  proxy → Transmission :9091
  ├── /downloads/*         →  alias → /var/lib/.../downloads/  (direct file serve)
  ├── /delete              →  proxy → zipper.py :5001  (permanent file delete)
  ├── /api/*               →  proxy → updater.py :5002  (git deploy API)
  └── /zip?path=X          →  proxy → zipper.py :5001  (streaming ZIP)
                                         │
                                         └── reads/writes /var/lib/.../downloads/
```

