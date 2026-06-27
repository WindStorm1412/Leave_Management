const fs = require('node:fs');
const path = require('node:path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv();

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'leave_management',
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  autoCreate: String(process.env.DB_AUTO_CREATE || 'true').toLowerCase() !== 'false',
  autoSeed: String(process.env.DB_AUTO_SEED || 'true').toLowerCase() !== 'false'
};

if (!/^[a-zA-Z0-9_]+$/.test(config.database)) {
  throw new Error('DB_NAME chỉ được chứa chữ cái, chữ số và dấu gạch dưới.');
}

module.exports = config;
