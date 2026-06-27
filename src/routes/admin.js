const { db, logAudit } = require('../../db');
const { json, fail, readBody } = require('../http');
const { requireAuth, ipOf } = require('../auth');
const { isDuplicateError } = require('../leave-utils');

async function handleAdmin(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (method === 'GET' && pathname === '/api/departments') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const rows = await db.prepare(`
      SELECT d.*, COUNT(u.id) AS members,
             MAX(CASE WHEN u.role = 'manager' THEN u.full_name ELSE '' END) AS manager
      FROM departments d
      LEFT JOIN users u ON u.department_id = d.id
      GROUP BY d.id
      ORDER BY d.code
    `).all();
    const items = rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      members: row.members,
      manager: row.manager || '',
      createdAt: row.created_at
    }));
    return json(res, 200, { items });
  }

  if (method === 'POST' && pathname === '/api/departments') {
    const user = await requireAuth(req, res, ['admin']);
    if (!user) return true;
    const body = await readBody(req);
    if (!body.code || !body.name) {
      return fail(res, 400, 'Vui lòng nhập mã và tên phòng ban.');
    }
    try {
      const result = await db.prepare(`
        INSERT INTO departments (code, name) VALUES (?, ?)
      `).run(
        String(body.code).trim().toUpperCase(),
        String(body.name).trim()
      );
      await logAudit(user, 'Tạo phòng ban', `Tạo phòng ban ${body.name}`, ipOf(req));
      return json(res, 201, { id: Number(result.lastInsertRowid) });
    } catch (error) {
      if (isDuplicateError(error)) {
        return fail(res, 409, 'Mã hoặc tên phòng ban đã tồn tại.');
      }
      throw error;
    }
  }

  const departmentMatch = pathname.match(/^\/api\/departments\/(\d+)$/);
  if (method === 'PUT' && departmentMatch) {
    const user = await requireAuth(req, res, ['admin']);
    if (!user) return true;
    const body = await readBody(req);
    const current = await db.prepare('SELECT * FROM departments WHERE id = ?').get(
      Number(departmentMatch[1])
    );
    if (!current) return fail(res, 404, 'Không tìm thấy phòng ban.');
    try {
      await db.prepare(`
        UPDATE departments SET code = ?, name = ? WHERE id = ?
      `).run(
        String(body.code ?? current.code).trim().toUpperCase(),
        String(body.name ?? current.name).trim(),
        current.id
      );
      await logAudit(
        user,
        'Cập nhật phòng ban',
        `Cập nhật phòng ban ${current.code}`,
        ipOf(req)
      );
      return json(res, 200, { ok: true });
    } catch (error) {
      if (isDuplicateError(error)) {
        return fail(res, 409, 'Mã hoặc tên phòng ban đã tồn tại.');
      }
      throw error;
    }
  }

  if (method === 'DELETE' && departmentMatch) {
    const user = await requireAuth(req, res, ['admin']);
    if (!user) return true;
    const departmentId = Number(departmentMatch[1]);
    const members = Number((await db.prepare(`
      SELECT COUNT(*) AS count FROM users WHERE department_id = ?
    `).get(departmentId)).count);
    if (members) return fail(res, 409, 'Không thể xóa phòng ban đang có nhân sự.');
    const result = await db.prepare('DELETE FROM departments WHERE id = ?').run(departmentId);
    if (!result.changes) return fail(res, 404, 'Không tìm thấy phòng ban.');
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/reports') {
    const user = await requireAuth(req, res, ['manager', 'hr', 'admin']);
    if (!user) return true;
    const year = Number(url.searchParams.get('year') || new Date().getFullYear());
    const departmentFilter = user.role === 'manager' ? ' AND d.id = ?' : '';
    const params = user.role === 'manager' ? [year, user.departmentId] : [year];
    const departments = await db.prepare(`
      SELECT d.name,
        COUNT(r.id) AS total,
        SUM(CASE WHEN r.status = 'approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN r.status LIKE 'rejected_%' THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN r.status LIKE 'pending_%' THEN 1 ELSE 0 END) AS pending,
        COALESCE(SUM(CASE WHEN r.status = 'approved' THEN r.days ELSE 0 END), 0) AS days
      FROM departments d
      LEFT JOIN users u ON u.department_id = d.id
      LEFT JOIN leave_requests r ON r.user_id = u.id AND YEAR(r.start_date) = ?
      WHERE 1=1${departmentFilter}
      GROUP BY d.id
      ORDER BY total DESC
    `).all(...params);
    const monthly = await db.prepare(`
      SELECT MONTH(r.start_date) AS month,
             SUM(CASE WHEN r.status = 'approved' THEN r.days ELSE 0 END) AS days
      FROM leave_requests r
      JOIN users u ON u.id = r.user_id
      WHERE YEAR(r.start_date) = ?
        ${user.role === 'manager' ? 'AND u.department_id = ?' : ''}
      GROUP BY month
      ORDER BY month
    `).all(...params);
    const types = await db.prepare(`
      SELECT lt.name, COUNT(r.id) AS total
      FROM leave_types lt
      LEFT JOIN leave_requests r
        ON r.leave_type_id = lt.id AND YEAR(r.start_date) = ?
      LEFT JOIN users u ON u.id = r.user_id
      WHERE 1=1
        ${user.role === 'manager' ? 'AND (u.department_id = ? OR r.id IS NULL)' : ''}
      GROUP BY lt.id
      ORDER BY total DESC
    `).all(...params);
    return json(res, 200, { year, departments, monthly, types });
  }

  if (method === 'GET' && pathname === '/api/audit-logs') {
    const user = await requireAuth(req, res, ['admin']);
    if (!user) return true;
    const rows = await db.prepare(`
      SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 300
    `).all();
    const items = rows.map((row) => ({
      id: row.id,
      username: row.username,
      action: row.action,
      detail: row.detail,
      ip: row.ip,
      createdAt: row.created_at
    }));
    return json(res, 200, { items });
  }

  return false;
}

module.exports = handleAdmin;
