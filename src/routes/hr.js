const { db, hashPassword, logAudit } = require('../../db');
const { json, fail, readBody } = require('../http');
const {
  requireAuth,
  publicUser,
  initials,
  ipOf
} = require('../auth');
const { ROLE_LABELS } = require('../constants');
const {
  validDate,
  ensureBalance,
  isDuplicateError
} = require('../leave-utils');

async function handleHR(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (method === 'GET' && pathname === '/api/hr/users') {
    const user = await requireAuth(req, res, ['hr', 'admin']);
    if (!user) return true;
    const items = (await db.prepare(`
      SELECT u.*, d.name AS department_name
      FROM users u LEFT JOIN departments d ON d.id = u.department_id
      ORDER BY u.employee_code
    `).all()).map(publicUser);
    return json(res, 200, { items });
  }

  if (method === 'POST' && pathname === '/api/hr/users') {
    const user = await requireAuth(req, res, ['hr', 'admin']);
    if (!user) return true;
    const body = await readBody(req);
    const employeeCode = String(body.employeeCode || '').trim().toUpperCase();
    const username = String(body.username || '').trim();
    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim();
    const role = String(body.role || 'employee');
    const departmentId = Number(body.departmentId);
    const startDate = String(body.startDate || '');
    const password = String(body.password || '123456');
    if (!employeeCode || !username || !fullName || !email
      || !validDate(startDate) || !ROLE_LABELS[role]) {
      return fail(res, 400, 'Thông tin nhân sự chưa đầy đủ hoặc không hợp lệ.');
    }
    if (role === 'admin' && user.role !== 'admin') {
      return fail(res, 403, 'Chỉ quản trị viên được tạo tài khoản admin.');
    }
    if (password.length < 6) {
      return fail(res, 400, 'Mật khẩu phải có ít nhất 6 ký tự.');
    }
    try {
      const created = await db.transaction(async (client) => {
        const result = await client.prepare(`
          INSERT INTO users
            (employee_code, username, password_hash, full_name, email, phone,
             role, department_id, start_date, avatar)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          employeeCode,
          username,
          hashPassword(password),
          fullName,
          email,
          String(body.phone || ''),
          role,
          departmentId,
          startDate,
          initials(fullName)
        );
        const row = await client.prepare(`
          SELECT u.*, d.name AS department_name
          FROM users u
          LEFT JOIN departments d ON d.id = u.department_id
          WHERE u.id = ?
        `).get(Number(result.lastInsertRowid));
        const annualTypes = await client.prepare(`
          SELECT id FROM leave_types WHERE active = 1 AND annual_quota > 0
        `).all();
        for (const type of annualTypes) {
          await ensureBalance(row.id, type.id, new Date().getFullYear(), client);
        }
        await logAudit(
          user,
          'Tạo nhân sự',
          `Tạo tài khoản ${username} cho ${fullName}`,
          ipOf(req),
          client
        );
        return row;
      });
      return json(res, 201, { item: publicUser(created) });
    } catch (error) {
      if (isDuplicateError(error)) {
        return fail(res, 409, 'Mã nhân viên, tên đăng nhập hoặc email đã tồn tại.');
      }
      throw error;
    }
  }

  const userMatch = pathname.match(/^\/api\/hr\/users\/(\d+)$/);
  if (method === 'PUT' && userMatch) {
    const actor = await requireAuth(req, res, ['hr', 'admin']);
    if (!actor) return true;
    const targetId = Number(userMatch[1]);
    const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!target) return fail(res, 404, 'Không tìm thấy nhân sự.');
    const body = await readBody(req);
    const role = String(body.role || target.role);
    if ((target.role === 'admin' || role === 'admin') && actor.role !== 'admin') {
      return fail(res, 403, 'Chỉ admin được chỉnh sửa tài khoản admin.');
    }
    if (targetId === actor.id && body.active === false) {
      return fail(res, 400, 'Bạn không thể tự khóa tài khoản của mình.');
    }
    if (body.password && String(body.password).length < 6) {
      return fail(res, 400, 'Mật khẩu phải có ít nhất 6 ký tự.');
    }
    try {
      await db.transaction(async (client) => {
        await client.prepare(`
          UPDATE users
          SET full_name = ?, email = ?, phone = ?, role = ?, department_id = ?,
              start_date = ?, active = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          String(body.fullName ?? target.full_name).trim(),
          String(body.email ?? target.email).trim(),
          String(body.phone ?? target.phone).trim(),
          role,
          Number(body.departmentId ?? target.department_id),
          String(body.startDate ?? target.start_date),
          body.active === undefined ? target.active : body.active ? 1 : 0,
          initials(String(body.fullName ?? target.full_name)),
          targetId
        );
        if (body.password) {
          await client.prepare(
            'UPDATE users SET password_hash = ? WHERE id = ?'
          ).run(hashPassword(String(body.password)), targetId);
          await client.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
        }
        await logAudit(
          actor,
          'Cập nhật nhân sự',
          `Cập nhật tài khoản ${target.username}`,
          ipOf(req),
          client
        );
      });
      return json(res, 200, { ok: true });
    } catch (error) {
      if (isDuplicateError(error)) return fail(res, 409, 'Email đã được sử dụng.');
      throw error;
    }
  }

  if (method === 'GET' && pathname === '/api/hr/balances') {
    const user = await requireAuth(req, res, ['hr', 'admin']);
    if (!user) return true;
    const year = Number(url.searchParams.get('year') || new Date().getFullYear());
    const rows = await db.prepare(`
      SELECT lb.*, u.full_name, u.employee_code, lt.name AS leave_type_name
      FROM leave_balances lb
      JOIN users u ON u.id = lb.user_id
      JOIN leave_types lt ON lt.id = lb.leave_type_id
      WHERE lb.year = ?
      ORDER BY u.full_name, lt.name
    `).all(year);
    const items = rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      employeeCode: row.employee_code,
      employeeName: row.full_name,
      leaveType: row.leave_type_name,
      year: row.year,
      allocated: row.allocated,
      used: row.used,
      adjustment: row.adjustment,
      remaining: row.allocated + row.adjustment - row.used
    }));
    return json(res, 200, { year, items });
  }

  const balanceMatch = pathname.match(/^\/api\/hr\/balances\/(\d+)$/);
  if (method === 'PUT' && balanceMatch) {
    const user = await requireAuth(req, res, ['hr', 'admin']);
    if (!user) return true;
    const body = await readBody(req);
    const allocated = Number(body.allocated);
    const adjustment = Number(body.adjustment);
    if (!Number.isFinite(allocated) || !Number.isFinite(adjustment) || allocated < 0) {
      return fail(res, 400, 'Số ngày phép không hợp lệ.');
    }
    const result = await db.prepare(`
      UPDATE leave_balances SET allocated = ?, adjustment = ? WHERE id = ?
    `).run(allocated, adjustment, Number(balanceMatch[1]));
    if (!result.changes) return fail(res, 404, 'Không tìm thấy số dư phép.');
    await logAudit(
      user,
      'Điều chỉnh phép',
      `Điều chỉnh bảng phép #${balanceMatch[1]}`,
      ipOf(req)
    );
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/hr/leave-types') {
    const user = await requireAuth(req, res, ['hr', 'admin']);
    if (!user) return true;
    const rows = await db.prepare('SELECT * FROM leave_types ORDER BY id').all();
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

  if (method === 'POST' && pathname === '/api/hr/leave-types') {
    const user = await requireAuth(req, res, ['hr', 'admin']);
    if (!user) return true;
    const body = await readBody(req);
    const code = String(body.code || '').trim().toUpperCase();
    const name = String(body.name || '').trim();
    if (!code || !name) return fail(res, 400, 'Vui lòng nhập mã và tên loại phép.');
    try {
      const result = await db.prepare(`
        INSERT INTO leave_types
          (code, name, annual_quota, max_days, requires_proof, paid, description)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        code,
        name,
        Number(body.annualQuota || 0),
        Number(body.maxDays || 0),
        body.requiresProof ? 1 : 0,
        body.paid === false ? 0 : 1,
        String(body.description || '').trim()
      );
      await logAudit(user, 'Tạo loại phép', `Tạo loại phép ${name}`, ipOf(req));
      return json(res, 201, { id: Number(result.lastInsertRowid) });
    } catch (error) {
      if (isDuplicateError(error)) {
        return fail(res, 409, 'Mã hoặc tên loại phép đã tồn tại.');
      }
      throw error;
    }
  }

  const typeMatch = pathname.match(/^\/api\/hr\/leave-types\/(\d+)$/);
  if (method === 'PUT' && typeMatch) {
    const user = await requireAuth(req, res, ['hr', 'admin']);
    if (!user) return true;
    const body = await readBody(req);
    const existing = await db.prepare(
      'SELECT * FROM leave_types WHERE id = ?'
    ).get(Number(typeMatch[1]));
    if (!existing) return fail(res, 404, 'Không tìm thấy loại phép.');
    try {
      await db.prepare(`
        UPDATE leave_types
        SET name = ?, annual_quota = ?, max_days = ?, requires_proof = ?,
            paid = ?, description = ?, active = ?
        WHERE id = ?
      `).run(
        String(body.name ?? existing.name).trim(),
        Number(body.annualQuota ?? existing.annual_quota),
        Number(body.maxDays ?? existing.max_days),
        body.requiresProof === undefined
          ? existing.requires_proof : body.requiresProof ? 1 : 0,
        body.paid === undefined ? existing.paid : body.paid ? 1 : 0,
        String(body.description ?? existing.description).trim(),
        body.active === undefined ? existing.active : body.active ? 1 : 0,
        existing.id
      );
      await logAudit(user, 'Cập nhật loại phép', `Cập nhật ${existing.code}`, ipOf(req));
      return json(res, 200, { ok: true });
    } catch (error) {
      if (isDuplicateError(error)) {
        return fail(res, 409, 'Tên loại phép đã tồn tại.');
      }
      throw error;
    }
  }

  if (method === 'POST' && pathname === '/api/holidays') {
    const user = await requireAuth(req, res, ['hr', 'admin']);
    if (!user) return true;
    const body = await readBody(req);
    if (!body.name || !validDate(body.startDate)
      || !validDate(body.endDate) || body.startDate > body.endDate) {
      return fail(res, 400, 'Thông tin ngày nghỉ lễ không hợp lệ.');
    }
    const result = await db.prepare(`
      INSERT INTO holidays (name, start_date, end_date) VALUES (?, ?, ?)
    `).run(String(body.name).trim(), body.startDate, body.endDate);
    await logAudit(user, 'Tạo ngày lễ', `Tạo ngày lễ ${body.name}`, ipOf(req));
    return json(res, 201, { id: Number(result.lastInsertRowid) });
  }

  const holidayMatch = pathname.match(/^\/api\/holidays\/(\d+)$/);
  if (method === 'DELETE' && holidayMatch) {
    const user = await requireAuth(req, res, ['hr', 'admin']);
    if (!user) return true;
    const result = await db.prepare('DELETE FROM holidays WHERE id = ?').run(
      Number(holidayMatch[1])
    );
    if (!result.changes) return fail(res, 404, 'Không tìm thấy ngày lễ.');
    await logAudit(user, 'Xóa ngày lễ', `Xóa ngày lễ #${holidayMatch[1]}`, ipOf(req));
    return json(res, 200, { ok: true });
  }

  return false;
}

module.exports = handleHR;
