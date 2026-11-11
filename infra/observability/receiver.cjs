/** @file Локальный Alertmanager receiver: bounded RAM journal, без внешних сообщений и произвольного downstream. */
const http = require('node:http');
/** Создаёт изолированный receiver. Limiting тела и сохраняемых полей защищает RAM отдельно от числа notifications. */
function createReceiver() {
  const notifications = [];
  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/notifications') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(notifications));
      return;
    }
    if (req.method !== 'POST' || req.url !== '/alerts') {
      res.writeHead(404).end();
      return;
    }
    let bytes = 0;
    const chunks = [];
    req.on('error', () => {});
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 1048576) {
        res.writeHead(413).end();
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (!body || !['firing', 'resolved'].includes(body.status) || !Array.isArray(body.alerts))
          throw new Error('Invalid notification');
        notifications.push({
          receivedAt: new Date().toISOString(),
          status: body.status,
          alerts: body.alerts.slice(0, 20).map((alert) => ({
            status: alert.status === 'resolved' ? 'resolved' : 'firing',
            labels: Object.fromEntries(
              ['alertname', 'severity', 'job', 'instance'].flatMap((key) =>
                typeof alert.labels?.[key] === 'string'
                  ? [[key, alert.labels[key].slice(0, 128)]]
                  : [],
              ),
            ),
          })),
        });
        if (notifications.length > 100) notifications.shift();
        res.writeHead(200).end();
      } catch {
        res.writeHead(400).end();
      }
    });
  });
}
module.exports = { createReceiver };
if (require.main === module) createReceiver().listen(8080, '0.0.0.0');
