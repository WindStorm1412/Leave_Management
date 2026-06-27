const crypto = require('node:crypto');
const {
  db,
  config: databaseConfig,
  verifyPassword,
  logAudit
} = require('../../db');
const { json, fail, readBody } = require('../http');
const {
  parseCookies,
  tokenHash,
  ipOf,
  publicUser,
  requireAuth
} = require('../auth');
const { requestRows, serializeRequests } = require('../leave-utils');

const SESSION_DAYS = 7;

async function handleAuthDashboard(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (method === 'GET' && pathname === '/api/health') {
    return json(res, 200, {
      ok: true,
      database: databaseConfig.database,
      engine: 'MySQL',
      host: databaseConfig.host,
      time: new Date().toISOString()
    });
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const row = await db.prepare(`
      SELECT u.*, d.name AS department_name
      FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE lower(u.username) = lower(?)
    `).get(username);
    if (!row || !row.active || !verifyPassword(password, row.password_hash)) {
      return fail(res, 401, 'Tên đăng nhập hoặc mật khẩu không đúng.');
    }
    await db.prepare('DELETE FROM sessions WHERE expires_at <= NOW()').run();
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
    await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
      tokenHash(token),
      row.id,
      expires
    );
    await logAudit(row, 'Đăng nhập', 'Đăng nhập hệ thống thành công', ipOf(req));
    return json(res, 200, { user: publicUser(row) }, {
      'Set-Cookie': `leave_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`
    });
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    const token = parseCookies(req).leave_session;
    if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
    return json(res, 200, { ok: true }, {
      'Set-Cookie': 'leave_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
    });
  }

  if (method === 'GET' && pathname === '/api/auth/me') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    return json(res, 200, { user });
  }

  if (method === 'GET' && pathname === '/api/dashboard') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const isEmployee = user.role === 'employee';
    const ownClause = isEmployee ? 'r.user_id = ?' : '1=1';
    const ownParams = isEmployee ? [user.id] : [];
    const total = Number((await db.prepare(
      `SELECT COUNT(*) AS count FROM leave_requests r WHERE ${ownClause}`
    ).get(...ownParams)).count);
    const approved = Number((await db.prepare(
      `SELECT COUNT(*) AS count FROM leave_requests r WHERE ${ownClause} AND r.status = 'approved'`
    ).get(...ownParams)).count);
    const pendingStatus = {
      leader: 'pending_leader',
      manager: 'pending_manager',
      hr: 'pending_hr'
    }[user.role];
    let pending;
    if (isEmployee) {
      pending = Number((await db.prepare(`
        SELECT COUNT(*) AS count FROM leave_requests
        WHERE user_id = ? AND status LIKE 'pending_%'
      `).get(user.id)).count);
    } else if (pendingStatus) {
      const departmentClause = ['leader', 'manager'].includes(user.role)
        ? ' AND u.department_id = ?'
        : '';
      const args = ['leader', 'manager'].includes(user.role)
        ? [pendingStatus, user.departmentId]
        : [pendingStatus];
      pending = Number((await db.prepare(`
        SELECT COUNT(*) AS count FROM leave_requests r
        JOIN users u ON u.id = r.user_id
        WHERE r.status = ?${departmentClause}
      `).get(...args)).count);
    } else {
      pending = Number((await db.prepare(`
        SELECT COUNT(*) AS count FROM leave_requests WHERE status LIKE 'pending_%'
      `).get()).count);
    }

    const year = new Date().getFullYear();
    const annual = Number((await db.prepare(`
      SELECT COALESCE(SUM(allocated + adjustment - used), 0) AS remaining
      FROM leave_balances WHERE user_id = ? AND year = ?
    `).get(user.id, year)).remaining);
    const employees = Number((await db.prepare(`
      SELECT COUNT(*) AS count FROM users WHERE role != 'admin' AND active = 1
    `).get()).count);
    const monthly = await db.prepare(`
      SELECT MONTH(start_date) AS month, SUM(days) AS days
      FROM leave_requests r
      WHERE YEAR(start_date) = ? AND status = 'approved'
        ${isEmployee ? 'AND user_id = ?' : ''}
      GROUP BY month ORDER BY month
    `).all(...(isEmployee ? [year, user.id] : [year]));
    const byType = await db.prepare(`
      SELECT lt.name, COUNT(*) AS total
      FROM leave_requests r JOIN leave_types lt ON lt.id = r.leave_type_id
      WHERE ${ownClause}
      GROUP BY lt.id ORDER BY total DESC
    `).all(...ownParams);
    const recentRows = await requestRows(
      isEmployee ? 'r.user_id = ?' : '1=1',
      isEmployee ? [user.id] : [],
      6
    );
    const recent = await serializeRequests(recentRows);
    return json(res, 200, {
      stats: {
        total,
        pending,
        approved,
        fourth: isEmployee ? annual : employees,
        fourthLabel: isEmployee ? 'Ngày phép còn lại' : 'Nhân sự đang hoạt động'
      },
      monthly,
      byType,
      recent
    });
  }

  if (method === 'GET' && pathname === '/api/leave-types') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const rows = await db.prepare('SELECT * FROM leave_types WHERE active = 1 ORDER BY id').all();
    return json(res, 200, {
      items: rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        annualQuota: row.annual_quota,
        maxDays: row.max_days,
        requiresProof: Boolean(row.requires_proof),
        paid: Boolean(row.paid),
        description: row.description,
        active: Boolean(row.active)
      }))
    });
  }

  return false;
}

module.exports = handleAuthDashboard;
