const { db, verifyPassword, hashPassword, logAudit } = require('../../db');
const { json, fail, readBody } = require('../http');
const {
  requireAuth,
  parseCookies,
  tokenHash,
  initials,
  ipOf
} = require('../auth');
const {
  datesBetween,
  requestRows,
  serializeRequests
} = require('../leave-utils');

async function handleEmployee(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (method === 'GET' && pathname === '/api/balances/me') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const year = Number(url.searchParams.get('year') || new Date().getFullYear());
    const balanceRows = await db.prepare(`
      SELECT lb.*, lt.name, lt.code
      FROM leave_balances lb JOIN leave_types lt ON lt.id = lb.leave_type_id
      WHERE lb.user_id = ? AND lb.year = ?
      ORDER BY lt.id
    `).all(user.id, year);
    const items = balanceRows.map((row) => ({
      id: row.id,
      year: row.year,
      leaveType: row.name,
      leaveTypeCode: row.code,
      allocated: row.allocated,
      used: row.used,
      adjustment: row.adjustment,
      remaining: row.allocated + row.adjustment - row.used
    }));
    const historyRows = await requestRows(
      "r.user_id = ? AND r.status = 'approved' AND YEAR(r.start_date) = ?",
      [user.id, year]
    );
    return json(res, 200, {
      year,
      items,
      history: await serializeRequests(historyRows)
    });
  }

  if (method === 'GET' && pathname === '/api/calendar') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const month = String(url.searchParams.get('month') || new Date().toISOString().slice(0, 7));
    const start = `${month}-01`;
    const monthDate = new Date(`${start}T00:00:00Z`);
    monthDate.setUTCMonth(monthDate.getUTCMonth() + 1);
    const end = new Date(monthDate.getTime() - 86400000).toISOString().slice(0, 10);
    let where = "r.status = 'approved' AND r.start_date <= ? AND r.end_date >= ?";
    const params = [end, start];
    if (['employee', 'leader', 'manager'].includes(user.role)) {
      where += ' AND u.department_id = ?';
      params.push(user.departmentId);
    }
    const rows = await db.prepare(`
      SELECT r.*, u.full_name, u.employee_code, u.department_id, d.name AS department_name,
             lt.name AS leave_type_name, lt.code AS leave_type_code, lt.annual_quota
      FROM leave_requests r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN departments d ON d.id = u.department_id
      JOIN leave_types lt ON lt.id = r.leave_type_id
      WHERE ${where}
      ORDER BY r.start_date
    `).all(...params);
    return json(res, 200, { month, items: await serializeRequests(rows) });
  }

  if (method === 'GET' && pathname === '/api/notifications') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const rows = await db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 30
    `).all(user.id);
    const items = rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      link: row.link,
      isRead: Boolean(row.is_read),
      createdAt: row.created_at
    }));
    return json(res, 200, {
      items,
      unread: items.filter((item) => !item.isRead).length
    });
  }

  if (method === 'POST' && pathname === '/api/notifications/read-all') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(user.id);
    return json(res, 200, { ok: true });
  }

  const notificationReadMatch = pathname.match(/^\/api\/notifications\/(\d+)\/read$/);
  if (method === 'POST' && notificationReadMatch) {
    const user = await requireAuth(req, res);
    if (!user) return true;
    await db.prepare(`
      UPDATE notifications SET is_read = 1
      WHERE id = ? AND user_id = ?
    `).run(Number(notificationReadMatch[1]), user.id);
    return json(res, 200, { ok: true });
  }

  if (method === 'DELETE' && pathname === '/api/notifications/read') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    await db.prepare('DELETE FROM notifications WHERE user_id = ? AND is_read = 1').run(user.id);
    return json(res, 200, { ok: true });
  }

  const notificationMatch = pathname.match(/^\/api\/notifications\/(\d+)$/);
  if (method === 'DELETE' && notificationMatch) {
    const user = await requireAuth(req, res);
    if (!user) return true;
    await db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(
      Number(notificationMatch[1]),
      user.id
    );
    return json(res, 200, { ok: true });
  }

  if (method === 'PUT' && pathname === '/api/profile') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const body = await readBody(req);
    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim();
    const phone = String(body.phone || '').trim();
    if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(res, 400, 'Họ tên hoặc email không hợp lệ.');
    }
    try {
      await db.prepare(`
        UPDATE users
        SET full_name = ?, email = ?, phone = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(fullName, email, phone, initials(fullName), user.id);
      await logAudit(user, 'Cập nhật hồ sơ', 'Cập nhật thông tin cá nhân', ipOf(req));
      return json(res, 200, { ok: true });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        return fail(res, 409, 'Email đã được sử dụng.');
      }
      throw error;
    }
  }

  if (method === 'PUT' && pathname === '/api/profile/password') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const body = await readBody(req);
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(currentPassword, row.password_hash)) {
      return fail(res, 400, 'Mật khẩu hiện tại không đúng.');
    }
    if (newPassword.length < 6) {
      return fail(res, 400, 'Mật khẩu mới phải có ít nhất 6 ký tự.');
    }
    await db.prepare(`
      UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(hashPassword(newPassword), user.id);
    await db.prepare(`
      DELETE FROM sessions WHERE user_id = ? AND token_hash != ?
    `).run(user.id, tokenHash(parseCookies(req).leave_session));
    await logAudit(user, 'Đổi mật khẩu', 'Đổi mật khẩu tài khoản', ipOf(req));
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/holidays') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const rows = await db.prepare('SELECT * FROM holidays ORDER BY start_date').all();
    const items = rows.map((row) => ({
      id: row.id,
      name: row.name,
      startDate: row.start_date,
      endDate: row.end_date,
      days: datesBetween(row.start_date, row.end_date).length
    }));
    return json(res, 200, { items });
  }

  return false;
}

module.exports = handleEmployee;
