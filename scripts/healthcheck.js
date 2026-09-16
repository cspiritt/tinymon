'use strict';

// Check HTTP liveness without credentials, including protected deployments.
const http = require('node:http');
const deadline = setTimeout(() => {
  console.error('Healthcheck timed out');
  process.exit(1);
}, 2000);

http.get('http://127.0.0.1:3000/api/status', (response) => {
  const status = response.statusCode;
  const healthy = (status >= 200 && status < 300) || status === 401;
  console.log(`Healthcheck HTTP ${status}`);
  clearTimeout(deadline);
  response.destroy();
  process.exit(healthy ? 0 : 1);
}).on('error', (error) => {
  console.error(`Healthcheck failed: ${error.message}`);
  process.exit(1);
});
