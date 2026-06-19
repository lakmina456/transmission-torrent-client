// config.js — Edit this to match your server setup
window.APP_CONFIG = {
  rpcPath:            '/rpc',       // dev proxy forwards this to Transmission
  fileServerBase:     '/downloads',
  zipServerBase:      '/zip',
  pollInterval:       3000,
  totalStorageGB:     500,   // set to your actual drive size in GB
  appName:            'CloudSeed',
  autoPasteMagnet:    true,
  zipWarnThresholdGB: 4,
  defaultTheme:       'light',
  speedGraphMinutes:  5,
};
