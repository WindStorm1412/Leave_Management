const http = require('node:http');
const {
  db,
  config: databaseConfig,
  initializeDatabase
} = require('../db');
const { fail, serveStatic } = require('./http');
const handleApi = require('./routes');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url.pathname);
    }
  } catch (error) {
    console.error(error);
    if (!res.headersSent) fail(res, 500, 'Máy chủ gặp lỗi. Vui lòng thử lại.');
    else res.end();
  }
});

async function startServer() {
  await initializeDatabase();
  if (server.listening) return server;
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(PORT, HOST);
  });
  console.log(`LeaveSystem đang chạy tại http://${HOST}:${PORT}`);
  console.log(
    `MySQL: ${databaseConfig.user}@${databaseConfig.host}:${databaseConfig.port}/${databaseConfig.database}`
  );
  return server;
}

async function stopServer() {
  if (server.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
  await db.close();
}

function runCli() {
  startServer().catch((error) => {
    console.error('Không thể khởi động LeaveSystem.');
    console.error(error.code === 'ECONNREFUSED'
      ? 'Không kết nối được MySQL. Hãy kiểm tra MySQL đang chạy và thông tin trong file .env.'
      : error.message);
    process.exitCode = 1;
  });

  process.once('SIGINT', async () => {
    await stopServer();
    process.exit(0);
  });
}

module.exports = { server, startServer, stopServer, runCli };
