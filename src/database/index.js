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
