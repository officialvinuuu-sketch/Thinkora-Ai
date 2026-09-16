// Core Intelligence safe Render launcher.
// Keep optional provider credentials from making the whole service crash at startup.
if (!process.env.HF_TOKEN) process.env.HF_TOKEN = 'disabled-provider-token';
require('../production-offline-bootstrap.js');
