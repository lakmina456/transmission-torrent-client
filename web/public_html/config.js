// config.js — Edit this to match your server setup
window.APP_CONFIG = {
  rpcPath:            '/rpc',       // dev proxy forwards this to Transmission
  fileServerBase:     '/downloads',
  zipServerBase:      '/zip',
  pollInterval:       3000,
  appName:            'CloudSeed',
  autoPasteMagnet:    true,
  zipWarnThresholdGB: 4,
  defaultTheme:       'light',
  speedGraphMinutes:  5,
  updateApiBase:      '/api',   // VPS: nginx proxies to cloudseed-updater :5002
};
