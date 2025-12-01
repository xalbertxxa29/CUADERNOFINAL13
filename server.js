#!/usr/bin/env node
/**
 * Simple HTTP Server para CUADERNO12
 * Sirve archivos estáticos en http://localhost:5100
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 5100;
const HOST = '0.0.0.0';
const DIR = __dirname;

// MIME Types
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Cache headers para archivos versionados
  if (req.url.includes('?v=')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (req.url.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  let filePath = path.join(DIR, url.parse(req.url).pathname);
  
  // Remover query string para búsqueda de archivos
  filePath = filePath.split('?')[0];

  // Si es directorio, servir index.html
  if (filePath.endsWith('/')) {
    filePath = path.join(filePath, 'index.html');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // 404 - Servir index.html para SPA (single page app)
      const indexPath = path.join(DIR, 'index.html');
      fs.readFile(indexPath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 - Not Found: ' + req.url);
          console.error(`[${new Date().toISOString()}] 404: ${req.url}`);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
      return;
    }

    // Archivo encontrado
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[SERVER] Servidor HTTP iniciado`);
  console.log(`[SERVER] Puerto: ${PORT}`);
  console.log(`[SERVER] URL: http://localhost:${PORT}`);
  console.log(`[SERVER] Directorio: ${DIR}`);
  console.log(`[SERVER] Estado: ESCUCHANDO`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[ERROR] Puerto ${PORT} ya está en uso`);
    process.exit(1);
  } else {
    console.error('[ERROR] ' + err.message);
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[SHUTDOWN] Cerrando servidor...');
  server.close(() => {
    console.log('[SHUTDOWN] Servidor cerrado');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[SHUTDOWN] Timeout, forzando salida...');
    process.exit(1);
  }, 10000);
});
