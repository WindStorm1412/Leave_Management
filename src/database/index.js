const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const config = require('./config');
const seed = require('./seed');
const { hashPassword, verifyPassword } = require('../security');

let pool;

function createClient(executor) {
  return {
    prepare(sql) {
      return {
        async get(...params) {
          const [rows] = await executor.execute(sql, params);
          return rows[0];
        },
        async all(...params) {
          const [rows] = await executor.execute(sql, params);
          return rows;
        },
        async run(...params) {
          const [result] = await executor.execute(sql, params);
          return {
            lastInsertRowid: result.insertId,
            changes: result.affectedRows
          };
        }
      };
    },
    async exec(sql) {
      return executor.query(sql);
    }
  };
}

const db = {
  prepare(sql) {
    if (!pool) throw new Error('Database chưa được khởi tạo.');
    return createClient(pool).prepare(sql);
  },
  async exec(sql) {
    if (!pool) throw new Error('Database chưa được khởi tạo.');
    return createClient(pool).exec(sql);
  },
  async transaction(callback) {
    if (!pool) throw new Error('Database chưa được khởi tạo.');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(createClient(connection));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
  async close() {
    if (pool) await pool.end();
    pool = null;
  }
};

function readSchema() {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'database.sql'), 'utf8');
  const firstTable = sql.indexOf('CREATE TABLE');
  if (firstTable < 0) throw new Error('database.sql không chứa cấu trúc bảng.');
  return sql.slice(firstTable);
}

async function columnExists(table, column) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
  `).get(config.database, table, column);
  return Number(row.count) > 0;
}

async function columnType(table, column) {
  const row = await db.prepare(`
    SELECT COLUMN_TYPE AS column_type
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
  `).get(config.database, table, column);
  return String(row?.column_type || '');
}

async function upgradeSchema() {
  if (!await columnExists('departments', 'leader_id')) {
    await db.exec(
      "ALTER TABLE departments ADD COLUMN leader_id INT UNSIGNED NULL COMMENT 'Trưởng nhóm được phân công' AFTER name"
    );
  }
  if (!await columnExists('departments', 'manager_id')) {
    await db.exec(
      "ALTER TABLE departments ADD COLUMN manager_id INT UNSIGNED NULL COMMENT 'Trưởng phòng được phân công' AFTER leader_id"
    );
  }
  if (!await columnType('approvals', 'approver_role').then((type) => type.includes("'admin'"))) {
    await db.exec(`
      ALTER TABLE approvals
      MODIFY COLUMN approver_role ENUM('leader','manager','hr','admin') NOT NULL
    `);
  }
  await db.exec(`
    UPDATE departments d
    SET d.leader_id = (
      SELECT MIN(u.id) FROM users u
      WHERE u.department_id = d.id AND u.role = 'leader' AND u.active = 1
    )
    WHERE d.leader_id IS NULL
  `);
  await db.exec(`
    UPDATE departments d
    SET d.manager_id = (
      SELECT MIN(u.id) FROM users u
      WHERE u.department_id = d.id AND u.role = 'manager' AND u.active = 1
    )
    WHERE d.manager_id IS NULL
  `);
  await db.exec(`
    UPDATE approvals a
    JOIN leave_requests r ON r.id = a.request_id
    JOIN users requester ON requester.id = r.user_id
    JOIN departments d ON d.id = requester.department_id
    SET a.approver_id = CASE
      WHEN a.approver_role = 'leader' THEN d.leader_id
      WHEN a.approver_role = 'manager' THEN d.manager_id
      ELSE a.approver_id
    END
    WHERE a.approver_id IS NULL
      AND a.approver_role IN ('leader', 'manager')
  `);
}

async function initializeDatabase() {
  if (config.autoCreate) {
    const bootstrap = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      charset: 'utf8mb4'
    });
    try {
      await bootstrap.query(
        `CREATE DATABASE IF NOT EXISTS \`${config.database}\` `
        + 'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
      );
    } finally {
      await bootstrap.end();
    }
  }

  pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: config.connectionLimit,
    queueLimit: 0,
    charset: 'utf8mb4',
    dateStrings: true,
    decimalNumbers: true,
    multipleStatements: true
  });

  await db.exec(readSchema());
  await upgradeSchema();
  if (config.autoSeed) await seed(db, hashPassword);
  return pool;
}

async function logAudit(user, action, detail, ip = '', client = db) {
  await client.prepare(`
    INSERT INTO audit_logs (user_id, username, action, detail, ip)
    VALUES (?, ?, ?, ?, ?)
  `).run(user?.id || null, user?.username || 'system', action, detail, ip);
}

module.exports = {
  db,
  config,
  initializeDatabase,
  hashPassword,
  verifyPassword,
  logAudit
};
