const { db, logAudit } = require('../../db');
const { json, fail, readBody } = require('../http');
const { requireAuth, ipOf } = require('../auth');
const { isDuplicateError } = require('../leave-utils');

async function validateDepartmentApprover(userId, role, departmentId, client = db) {
  if (!userId) return null;
  const person = await client.prepare(`
    SELECT id, full_name, role, department_id, active
    FROM users WHERE id = ?
  `).get(userId);
  if (!person || !person.active || person.role !== role
    || Number(person.department_id) !== Number(departmentId)) {
    const label = role === 'manager' ? 'trưởng phòng' : 'trưởng nhóm';
    throw Object.assign(
      new Error(`Người được chọn làm ${label} phải đang hoạt động, có đúng chức vụ và thuộc phòng ban này.`),
      { statusCode: 400 }
    );
  }
  return person;
}

async function handleAdmin(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (method === 'GET' && pathname === '/api/departments') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const rows = await db.prepare(`
      SELECT d.*, COUNT(u.id) AS members,
             SUM(CASE WHEN u.active = 1 THEN 1 ELSE 0 END) AS active_members,
             SUM(CASE WHEN u.role = 'employee' AND u.active = 1 THEN 1 ELSE 0 END) AS employees,
             MAX(leader.full_name) AS leader_name,
             MAX(manager.full_name) AS manager_name
      FROM departments d
      LEFT JOIN users u ON u.department_id = d.id
      LEFT JOIN users leader ON leader.id = d.leader_id
      LEFT JOIN users manager ON manager.id = d.manager_id
      GROUP BY d.id
      ORDER BY d.code
    `).all();
    const people = await db.prepare(`
      SELECT id, employee_code, full_name, role, department_id, active
      FROM users
      WHERE department_id IS NOT NULL
      ORDER BY full_name
    `).all();
    const items = rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      members: row.members,
      activeMembers: row.active_members,
      employees: row.employees,
      leaderId: row.leader_id,
      leader: row.leader_name || '',
      managerId: row.manager_id,
      manager: row.manager_name || '',
      people: people.filter((person) => person.department_id === row.id).map((person) => ({
        id: person.id,
        employeeCode: person.employee_code,
        fullName: person.full_name,
        role: person.role,
        active: Boolean(person.active)
      })),
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
      if (error.statusCode) return fail(res, error.statusCode, error.message);
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
      const leaderId = body.leaderId === undefined
        ? current.leader_id
        : Number(body.leaderId || 0) || null;
      const managerId = body.managerId === undefined
        ? current.manager_id
        : Number(body.managerId || 0) || null;
      await db.transaction(async (client) => {
        await validateDepartmentApprover(leaderId, 'leader', current.id, client);
        await validateDepartmentApprover(managerId, 'manager', current.id, client);
        await client.prepare(`
          UPDATE departments
          SET code = ?, name = ?, leader_id = ?, manager_id = ?
          WHERE id = ?
        `).run(
          String(body.code ?? current.code).trim().toUpperCase(),
          String(body.name ?? current.name).trim(),
          leaderId,
          managerId,
          current.id
        );
        await client.prepare(`
          UPDATE approvals a
          JOIN leave_requests r ON r.id = a.request_id
          JOIN users requester ON requester.id = r.user_id
          SET a.approver_id = ?
          WHERE requester.department_id = ? AND a.approver_role = 'leader'
            AND a.action IN ('pending', 'waiting')
        `).run(leaderId, current.id);
        await client.prepare(`
          UPDATE approvals a
          JOIN leave_requests r ON r.id = a.request_id
          JOIN users requester ON requester.id = r.user_id
          SET a.approver_id = ?
          WHERE requester.department_id = ? AND a.approver_role = 'manager'
            AND a.action IN ('pending', 'waiting')
        `).run(managerId, current.id);
      });
      await logAudit(
        user,
        'Cập nhật phòng ban',
        `Cập nhật phòng ban ${current.code}`,
        ipOf(req)
      );
      return json(res, 200, { ok: true });
    } catch (error) {
      if (error.statusCode) return fail(res, error.statusCode, error.message);
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
