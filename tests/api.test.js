const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function staticChecks() {
  const packageJson = JSON.parse(read('package.json'));
  const databaseSource = [
    read('db.js'),
    read('src/database/index.js'),
    read('src/database/config.js'),
    read('src/database/seed.js')
  ].join('\n');
  const backendFiles = [
    'server.js',
    'src/app.js',
    'src/auth.js',
    'src/http.js',
    'src/leave-utils.js',
    'src/security.js',
    'src/database/index.js',
    'src/database/config.js',
    'src/database/seed.js',
    'src/routes/index.js',
    'src/routes/auth-dashboard.js',
    'src/routes/requests.js',
    'src/routes/employee.js',
    'src/routes/hr.js',
    'src/routes/admin.js',
    'src/routes/exports.js'
  ];
  const serverSource = backendFiles.map(read).join('\n');
  const sql = read('database.sql');

  assert.ok(packageJson.dependencies.mysql2, 'Thiếu mysql2 trong dependencies');
  assert.match(databaseSource, /require\(['"]mysql2\/promise['"]\)/);
  assert.match(databaseSource, /mysql\.createPool/);
  assert.match(databaseSource, /beginTransaction\(\)/);
  assert.match(databaseSource, /utf8mb4/);
  assert.match(read('src/app.js'), /await initializeDatabase\(\)/);
  assert.match(serverSource, /YEAR\(r?\.?start_date\)/);
  assert.match(serverSource, /LIMIT \$\{safeLimit\}/);
  assert.doesNotMatch(serverSource, /LIMIT \?/);
  assert.doesNotMatch(serverSource, /node:sqlite/);
  assert.doesNotMatch(serverSource, /datetime\('now'\)/);
  assert.doesNotMatch(serverSource, /db\.exec\('BEGIN'\)/);
  assert.match(sql, /leader_id INT UNSIGNED NULL/);
  assert.match(sql, /manager_id INT UNSIGNED NULL/);
  assert.match(sql, /approver_role ENUM\('leader','manager','hr','admin'\)/);
  assert.match(read('src/routes/requests.js'), /buildApprovalFlow/);
  assert.match(read('src/routes/requests.js'), /decision_action/);

  for (const table of [
    'departments', 'users', 'leave_types', 'leave_balances', 'leave_requests',
    'approvals', 'holidays', 'notifications', 'sessions', 'audit_logs'
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }

  for (const file of [
    'public/index.html',
    'public/styles.css',
    'public/js/core.js',
    'public/js/pages/employee.js',
    'public/js/pages/hr.js',
    'public/js/pages/admin.js',
    'public/js/main.js',
    '.env.example',
    ...backendFiles
  ]) {
    assert.ok(fs.existsSync(path.join(root, file)), `Thiếu ${file}`);
  }

  const Module = require('node:module');
  const originalLoad = Module._load;
  try {
    Module._load = function loadWithMysqlStub(request, parent, isMain) {
      if (request === 'mysql2/promise') return {};
      return originalLoad.call(this, request, parent, isMain);
    };
    const exported = require('../server');
    assert.equal(typeof exported.startServer, 'function');
    assert.equal(typeof exported.stopServer, 'function');
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../server')];
    delete require.cache[require.resolve('../db')];
  }
}

async function integrationChecks() {
  const testDatabase = `leave_management_test_${Date.now()}`;
  process.env.DB_NAME = testDatabase;
  process.env.DB_AUTO_CREATE = 'true';
  process.env.DB_AUTO_SEED = 'true';
  process.env.HOST = '127.0.0.1';
  process.env.PORT = '3138';

  const { startServer, stopServer } = require('../server');
  const baseUrl = 'http://127.0.0.1:3138';

  async function request(pathname, { method = 'GET', body, cookie } = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    return {
      status: response.status,
      data,
      cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie
    };
  }

  async function login(username) {
    const response = await request('/api/auth/login', {
      method: 'POST',
      body: { username, password: '123456' }
    });
    assert.equal(response.status, 200);
    assert.ok(response.cookie);
    return response;
  }

  try {
    await startServer();

    const health = await request('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.data.engine, 'MySQL');
    assert.equal(health.data.database, testDatabase);

    const employee = await login('nhanvien01');
    const dashboard = await request('/api/dashboard', { cookie: employee.cookie });
    assert.equal(dashboard.status, 200);

    const types = await request('/api/leave-types', { cookie: employee.cookie });
    const annual = types.data.items.find((item) => item.code === 'LT01');
    assert.ok(annual);

    const year = new Date().getFullYear();
    const created = await request('/api/requests', {
      method: 'POST',
      cookie: employee.cookie,
      body: {
        leaveTypeId: annual.id,
        startDate: `${year}-12-14`,
        endDate: `${year}-12-15`,
        reason: 'Đơn kiểm thử MySQL'
      }
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.item.status, 'pending_leader');

    const cancelled = await request(`/api/requests/${created.data.item.id}/cancel`, {
      method: 'POST',
      cookie: employee.cookie
    });
    assert.equal(cancelled.status, 200);

    const admin = await login('admin');
    const logs = await request('/api/audit-logs', { cookie: admin.cookie });
    assert.equal(logs.status, 200);
    assert.ok(logs.data.items.length > 0);
  } finally {
    await stopServer();
    const mysql = require('mysql2/promise');
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || ''
    });
    try {
      await connection.query(`DROP DATABASE IF EXISTS \`${testDatabase}\``);
    } finally {
      await connection.end();
    }
  }
}

async function run() {
  staticChecks();
  if (process.env.MYSQL_INTEGRATION_TEST === 'true') {
    await integrationChecks();
    console.log('✓ Kiểm thử MySQL và API đã hoàn tất.');
  } else {
    console.log('✓ Source MySQL và database.sql hợp lệ.');
    console.log('  Đặt MYSQL_INTEGRATION_TEST=true để kiểm thử với MySQL đang chạy.');
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
