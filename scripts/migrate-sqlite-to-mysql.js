const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

process.env.DB_AUTO_SEED = 'false';

const sqlitePath = path.resolve(
  process.argv[2] || process.env.SQLITE_PATH || path.join(__dirname, '..', '..', 'data', 'leave-management.db')
);

if (!fs.existsSync(sqlitePath)) {
  console.error(`Không tìm thấy SQLite database: ${sqlitePath}`);
  console.error('Cách dùng: npm run migrate:sqlite -- "D:\\duong-dan\\leave-management.db"');
  process.exit(1);
}

const { db, initializeDatabase } = require('../db');

const tables = [
  {
    name: 'departments',
    columns: ['id', 'code', 'name', 'created_at']
  },
  {
    name: 'users',
    columns: [
      'id', 'employee_code', 'username', 'password_hash', 'full_name', 'email', 'phone',
      'role', 'department_id', 'start_date', 'active', 'avatar', 'created_at', 'updated_at'
    ]
  },
  {
    name: 'leave_types',
    columns: [
      'id', 'code', 'name', 'annual_quota', 'max_days', 'requires_proof',
      'paid', 'description', 'active'
    ]
  },
  {
    name: 'leave_balances',
    columns: ['id', 'user_id', 'leave_type_id', 'year', 'allocated', 'used', 'adjustment']
  },
  {
    name: 'leave_requests',
    columns: [
      'id', 'request_code', 'user_id', 'leave_type_id', 'start_date', 'end_date',
      'days', 'reason', 'status', 'current_step', 'attachment_name', 'created_at', 'updated_at'
    ]
  },
  {
    name: 'approvals',
    columns: ['id', 'request_id', 'step', 'approver_role', 'approver_id', 'action', 'note', 'acted_at']
  },
  {
    name: 'holidays',
    columns: ['id', 'name', 'start_date', 'end_date', 'created_at']
  },
  {
    name: 'notifications',
    columns: ['id', 'user_id', 'title', 'body', 'link', 'is_read', 'created_at']
  },
  {
    name: 'audit_logs',
    columns: ['id', 'user_id', 'username', 'action', 'detail', 'ip', 'created_at']
  }
];

function sqliteHasTable(sqlite, table) {
  return Boolean(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

async function migrate() {
  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    await initializeDatabase();
    const existing = Number((await db.prepare('SELECT COUNT(*) AS count FROM users').get()).count);
    if (existing > 0) {
      throw new Error('MySQL đã có dữ liệu. Hãy dùng database trống để tránh trùng hoặc mất dữ liệu.');
    }

    const summary = await db.transaction(async (client) => {
      const counts = {};
      for (const table of tables) {
        if (!sqliteHasTable(sqlite, table.name)) {
          counts[table.name] = 0;
          continue;
        }
        const rows = sqlite.prepare(`SELECT ${table.columns.join(', ')} FROM ${table.name}`).all();
        if (!rows.length) {
          counts[table.name] = 0;
          continue;
        }
        const placeholders = table.columns.map(() => '?').join(', ');
        const statement = client.prepare(
          `INSERT INTO ${table.name} (${table.columns.join(', ')}) VALUES (${placeholders})`
        );
        for (const row of rows) {
          await statement.run(...table.columns.map((column) => row[column] ?? null));
        }
        counts[table.name] = rows.length;
      }
      return counts;
    });

    console.log(`Đã chuyển dữ liệu từ: ${sqlitePath}`);
    for (const [table, count] of Object.entries(summary)) {
      console.log(`- ${table}: ${count} dòng`);
    }
    console.log('Phiên đăng nhập cũ không được chuyển; người dùng cần đăng nhập lại.');
  } finally {
    sqlite.close();
    await db.close();
  }
}

migrate().catch((error) => {
  console.error(`Chuyển dữ liệu thất bại: ${error.message}`);
  process.exitCode = 1;
});
