const { db, logAudit } = require('../../db');
const { json, fail, readBody } = require('../http');
const { requireAuth, ipOf } = require('../auth');
const { STATUS_LABELS } = require('../constants');
const {
  validDate,
  calculateBusinessDays,
  getRequest,
  serializeRequest,
  serializeRequests,
  requestRows,
  notify,
  notifyRole,
  ensureBalance
} = require('../leave-utils');

const ACTIVE_REQUEST_STATUS_SQL = "('cancelled','rejected_by_leader','rejected_by_manager','rejected_by_hr','rejected_by_admin')";

async function buildApprovalFlow(user, client = db) {
  if (user.role === 'hr') {
    return { steps: [{ role: 'admin', approverId: null, approverName: 'Quản trị viên' }] };
  }

  if (!user.departmentId) {
    return { error: 'Tài khoản chưa được xếp vào phòng ban.' };
  }
  const department = await client.prepare(`
    SELECT d.*,
           leader.full_name AS leader_name, leader.active AS leader_active,
           leader.role AS leader_role, leader.department_id AS leader_department_id,
           manager.full_name AS manager_name, manager.active AS manager_active,
           manager.role AS manager_role, manager.department_id AS manager_department_id
    FROM departments d
    LEFT JOIN users leader ON leader.id = d.leader_id
    LEFT JOIN users manager ON manager.id = d.manager_id
    WHERE d.id = ?
  `).get(user.departmentId);
  if (!department) return { error: 'Phòng ban của tài khoản không còn tồn tại.' };

  const steps = [];
  const validLeader = department.leader_id
    && department.leader_active
    && department.leader_role === 'leader'
    && department.leader_department_id === department.id;
  const validManager = department.manager_id
    && department.manager_active
    && department.manager_role === 'manager'
    && department.manager_department_id === department.id;

  if (user.role === 'employee' && validLeader && department.leader_id !== user.id) {
    steps.push({
      role: 'leader',
      approverId: department.leader_id,
      approverName: department.leader_name
    });
  }
  if (['employee', 'leader'].includes(user.role)) {
    if (!validManager || department.manager_id === user.id) {
      return { error: `Phòng ${department.name} chưa có trưởng phòng hợp lệ để duyệt đơn.` };
    }
    steps.push({
      role: 'manager',
      approverId: department.manager_id,
      approverName: department.manager_name
    });
  }
  steps.push({ role: 'hr', approverId: null, approverName: 'Bộ phận Nhân sự' });
  return { steps, departmentName: department.name };
}

async function canApproveRequest(user, requestId, client = db) {
  const approval = await client.prepare(`
    SELECT a.*, requester.department_id
    FROM approvals a
    JOIN leave_requests r ON r.id = a.request_id
    JOIN users requester ON requester.id = r.user_id
    WHERE a.request_id = ? AND a.action = 'pending'
      AND r.status = CONCAT('pending_', a.approver_role)
    ORDER BY a.step
    LIMIT 1
  `).get(requestId);
  if (!approval || approval.approver_role !== user.role) return false;
  if (approval.approver_id) return approval.approver_id === user.id;
  if (['leader', 'manager'].includes(user.role)) return false;
  return ['hr', 'admin'].includes(user.role);
}

async function buildRequestPreview(user, body) {
  const leaveTypeId = Number(body.leaveTypeId);
  const startDate = String(body.startDate || '');
  const endDate = String(body.endDate || '');
  const attachmentName = String(body.attachmentName || '').trim();

  if (!leaveTypeId || !validDate(startDate) || !validDate(endDate)) {
    return { errorStatus: 400, error: 'Vui lòng chọn loại phép, ngày bắt đầu và ngày kết thúc.' };
  }
  if (startDate > endDate) {
    return { errorStatus: 400, error: 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' };
  }
  if (startDate.slice(0, 4) !== endDate.slice(0, 4)) {
    return { errorStatus: 400, error: 'Đơn nghỉ không được kéo dài qua hai năm.' };
  }

  const type = await db.prepare(
    'SELECT * FROM leave_types WHERE id = ? AND active = 1'
  ).get(leaveTypeId);
  if (!type) return { errorStatus: 400, error: 'Loại nghỉ phép không hợp lệ.' };

  const days = await calculateBusinessDays(startDate, endDate);
  const warnings = [];
  let blocked = false;
  const approvalFlow = await buildApprovalFlow(user);
  if (approvalFlow.error) {
    blocked = true;
    warnings.push({ level: 'danger', message: approvalFlow.error });
  }

  if (days < 1) {
    blocked = true;
    warnings.push({
      level: 'danger',
      message: 'Khoảng thời gian này không có ngày làm việc.'
    });
  }
  if (type.max_days > 0 && days > type.max_days) {
    blocked = true;
    warnings.push({
      level: 'danger',
      message: `Loại phép này tối đa ${type.max_days} ngày mỗi đơn.`
    });
  }
  if (type.requires_proof && days >= 2 && !attachmentName) {
    blocked = true;
    warnings.push({
      level: 'danger',
      message: 'Loại phép này cần tệp minh chứng khi nghỉ từ 2 ngày.'
    });
  }

  const ownOverlap = await db.prepare(`
    SELECT request_code FROM leave_requests
    WHERE user_id = ?
      AND status NOT IN ${ACTIVE_REQUEST_STATUS_SQL}
      AND start_date <= ? AND end_date >= ?
    LIMIT 1
  `).get(user.id, endDate, startDate);
  if (ownOverlap) {
    blocked = true;
    warnings.push({
      level: 'danger',
      message: `Thời gian nghỉ bị trùng với đơn ${ownOverlap.request_code}.`
    });
  }

  const year = Number(startDate.slice(0, 4));
  let balance = null;
  if (type.annual_quota > 0) {
    const balanceRow = await db.prepare(`
      SELECT * FROM leave_balances
      WHERE user_id = ? AND leave_type_id = ? AND year = ?
    `).get(user.id, leaveTypeId, year);
    const pendingDays = Number((await db.prepare(`
      SELECT COALESCE(SUM(days), 0) AS days FROM leave_requests
      WHERE user_id = ? AND leave_type_id = ? AND YEAR(start_date) = ?
        AND status LIKE 'pending_%'
    `).get(user.id, leaveTypeId, year)).days);
    const allocated = Number(balanceRow?.allocated ?? type.annual_quota);
    const adjustment = Number(balanceRow?.adjustment ?? 0);
    const used = Number(balanceRow?.used ?? 0);
    const available = allocated + adjustment - used - pendingDays;
    balance = {
      year,
      annualQuota: Number(type.annual_quota),
      allocated,
      adjustment,
      used,
      pendingDays,
      available,
      remainingAfter: available - days
    };
    if (days > available) {
      blocked = true;
      warnings.push({
        level: 'danger',
        message: `Số ngày phép khả dụng chỉ còn ${available} ngày.`
      });
    }
  }

  const conflicts = await db.prepare(`
    SELECT r.request_code, r.start_date, r.end_date, r.days, r.status,
           u.full_name, lt.name AS leave_type_name
    FROM leave_requests r
    JOIN users u ON u.id = r.user_id
    JOIN leave_types lt ON lt.id = r.leave_type_id
    WHERE u.department_id = ?
      AND r.user_id != ?
      AND r.status NOT IN ${ACTIVE_REQUEST_STATUS_SQL}
      AND r.start_date <= ? AND r.end_date >= ?
    ORDER BY r.start_date, r.id
    LIMIT 8
  `).all(user.departmentId, user.id, endDate, startDate);
  if (conflicts.length) {
    warnings.push({
      level: 'info',
      message: `Có ${conflicts.length} lịch nghỉ khác trong phòng ban trùng thời gian này.`
    });
  }

  return {
    blocked,
    days,
    leaveType: {
      id: type.id,
      code: type.code,
      name: type.name,
      annualQuota: Number(type.annual_quota),
      maxDays: Number(type.max_days),
      requiresProof: Boolean(type.requires_proof)
    },
    balance,
    ownOverlap: ownOverlap?.request_code || '',
    conflicts: conflicts.map((row) => ({
      code: row.request_code,
      employeeName: row.full_name,
      leaveType: row.leave_type_name,
      startDate: row.start_date,
      endDate: row.end_date,
      days: row.days,
      status: row.status,
      statusLabel: STATUS_LABELS[row.status] || row.status
    })),
    approvalFlow: approvalFlow.steps || [],
    warnings
  };
}

async function handleRequests(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (method === 'GET' && pathname === '/api/requests') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const scope = url.searchParams.get('scope') || 'my';
    const status = url.searchParams.get('status');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const departmentId = Number(url.searchParams.get('departmentId') || 0);
    let where = 'r.user_id = ?';
    let params = [user.id];
    if (scope === 'all' && ['hr', 'admin'].includes(user.role)) {
      where = '1=1';
      params = [];
      if (departmentId) {
        where += ' AND u.department_id = ?';
        params.push(departmentId);
      }
    } else if (scope === 'team' && ['leader', 'manager'].includes(user.role)) {
      where = 'u.department_id = ?';
      params = [user.departmentId];
    }
    if (status) {
      if (status === 'rejected') {
        where += " AND r.status LIKE 'rejected_%'";
      } else {
        where += ' AND r.status = ?';
        params.push(status);
      }
    }
    if (from && validDate(from)) {
      where += ' AND r.end_date >= ?';
      params.push(from);
    }
    if (to && validDate(to)) {
      where += ' AND r.start_date <= ?';
      params.push(to);
    }
    const items = await serializeRequests(await requestRows(where, params));
    return json(res, 200, { items });
  }

  if (method === 'POST' && pathname === '/api/requests/preview') {
    const user = await requireAuth(req, res, ['employee', 'leader', 'manager', 'hr']);
    if (!user) return true;
    const preview = await buildRequestPreview(user, await readBody(req));
    if (preview.error) return fail(res, preview.errorStatus || 400, preview.error);
    return json(res, 200, preview);
  }

  const requestDetailMatch = pathname.match(/^\/api\/requests\/(\d+)$/);
  if (method === 'GET' && requestDetailMatch) {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const row = await getRequest(Number(requestDetailMatch[1]));
    if (!row) return fail(res, 404, 'Không tìm thấy đơn nghỉ phép.');
    const assignedApprover = await canApproveRequest(user, row.id);
    const handledByUser = Boolean(await db.prepare(`
      SELECT id FROM approvals WHERE request_id = ? AND approver_id = ? LIMIT 1
    `).get(row.id, user.id));
    const canView = row.user_id === user.id
      || ['hr', 'admin'].includes(user.role)
      || assignedApprover
      || handledByUser
      || (['leader', 'manager'].includes(user.role) && row.department_id === user.departmentId);
    if (!canView) return fail(res, 403, 'Bạn không có quyền xem đơn này.');
    const item = await serializeRequest(row, true);
    item.canApprove = assignedApprover && row.user_id !== user.id;
    return json(res, 200, { item });
  }

  if (method === 'POST' && pathname === '/api/requests') {
    const user = await requireAuth(req, res, ['employee', 'leader', 'manager', 'hr']);
    if (!user) return true;
    const body = await readBody(req);
    const leaveTypeId = Number(body.leaveTypeId);
    const startDate = String(body.startDate || '');
    const endDate = String(body.endDate || '');
    const reason = String(body.reason || '').trim();
    const attachmentName = String(body.attachmentName || '').trim().slice(0, 180);
    if (!leaveTypeId || !validDate(startDate) || !validDate(endDate) || !reason) {
      return fail(res, 400, 'Vui lòng điền đầy đủ loại phép, thời gian và lý do.');
    }
    if (startDate > endDate) {
      return fail(res, 400, 'Ngày kết thúc phải từ ngày bắt đầu trở đi.');
    }
    if (startDate.slice(0, 4) !== endDate.slice(0, 4)) {
      return fail(res, 400, 'Đơn nghỉ không được kéo dài qua hai năm.');
    }
    const type = await db.prepare(
      'SELECT * FROM leave_types WHERE id = ? AND active = 1'
    ).get(leaveTypeId);
    if (!type) return fail(res, 400, 'Loại nghỉ phép không hợp lệ.');

    const days = await calculateBusinessDays(startDate, endDate);
    if (days < 1) return fail(res, 400, 'Khoảng thời gian này không có ngày làm việc.');
    if (type.max_days > 0 && days > type.max_days) {
      return fail(res, 400, `Loại phép này tối đa ${type.max_days} ngày mỗi đơn.`);
    }
    if (type.requires_proof && days >= 2 && !attachmentName) {
      return fail(res, 400, 'Loại phép này cần tên tệp minh chứng khi nghỉ từ 2 ngày.');
    }
    const approvalFlow = await buildApprovalFlow(user);
    if (approvalFlow.error) return fail(res, 409, approvalFlow.error);

    const overlap = await db.prepare(`
      SELECT request_code FROM leave_requests
      WHERE user_id = ?
        AND status NOT IN ${ACTIVE_REQUEST_STATUS_SQL}
        AND start_date <= ? AND end_date >= ?
      LIMIT 1
    `).get(user.id, endDate, startDate);
    if (overlap) return fail(res, 409, `Thời gian nghỉ bị trùng với đơn ${overlap.request_code}.`);

    const year = Number(startDate.slice(0, 4));
    if (type.annual_quota > 0) {
      const balance = await ensureBalance(user.id, leaveTypeId, year);
      const pendingDays = Number((await db.prepare(`
        SELECT COALESCE(SUM(days), 0) AS days FROM leave_requests
        WHERE user_id = ? AND leave_type_id = ? AND YEAR(start_date) = ?
          AND status LIKE 'pending_%'
      `).get(user.id, leaveTypeId, year)).days);
      const available = balance.allocated + balance.adjustment - balance.used - pendingDays;
      if (days > available) {
        return fail(res, 400, `Số ngày phép khả dụng chỉ còn ${available} ngày.`);
      }
    }

    const item = await db.transaction(async (client) => {
      const result = await client.prepare(`
        INSERT INTO leave_requests
          (user_id, leave_type_id, start_date, end_date, days, reason,
           attachment_name, status, current_step)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        user.id,
        leaveTypeId,
        startDate,
        endDate,
        days,
        reason,
        attachmentName,
        `pending_${approvalFlow.steps[0].role}`,
        1
      );
      const requestId = Number(result.lastInsertRowid);
      const code = `LR${String(requestId).padStart(4, '0')}`;
      await client.prepare(
        'UPDATE leave_requests SET request_code = ? WHERE id = ?'
      ).run(code, requestId);
      for (const [index, approval] of approvalFlow.steps.entries()) {
        await client.prepare(`
          INSERT INTO approvals
            (request_id, step, approver_role, approver_id, action)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          requestId,
          index + 1,
          approval.role,
          approval.approverId,
          index === 0 ? 'pending' : 'waiting'
        );
      }
      await logAudit(
        user,
        'Tạo đơn',
        `Tạo đơn ${code} - ${type.name}`,
        ipOf(req),
        client
      );
      const firstApproval = approvalFlow.steps[0];
      if (firstApproval.approverId) {
        await notify(
          firstApproval.approverId,
          `Đơn ${code} chờ duyệt`,
          `${user.fullName} vừa gửi đơn ${type.name}.`,
          'approvals',
          client
        );
      } else {
        await notifyRole(
          firstApproval.role,
          user.departmentId,
          `Đơn ${code} chờ duyệt`,
          `${user.fullName} vừa gửi đơn ${type.name}.`,
          'approvals',
          client
        );
      }
      return serializeRequest(await getRequest(requestId, client), true, client);
    });
    return json(res, 201, { item });
  }

  const cancelMatch = pathname.match(/^\/api\/requests\/(\d+)\/cancel$/);
  if (method === 'POST' && cancelMatch) {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const row = await getRequest(Number(cancelMatch[1]));
    if (!row) return fail(res, 404, 'Không tìm thấy đơn nghỉ phép.');
    if (row.user_id !== user.id) {
      return fail(res, 403, 'Bạn chỉ có thể hủy đơn của chính mình.');
    }
    if (!row.status.startsWith('pending_')) {
      return fail(res, 400, 'Chỉ có thể hủy đơn đang chờ duyệt.');
    }
    await db.prepare(`
      UPDATE leave_requests
      SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(row.id);
    await logAudit(user, 'Hủy đơn', `Hủy đơn ${row.request_code}`, ipOf(req));
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/approvals') {
    const user = await requireAuth(req, res, ['leader', 'manager', 'hr', 'admin']);
    if (!user) return true;
    let where = "a.action = 'pending' AND r.status = CONCAT('pending_', a.approver_role) AND a.approver_role = ? AND r.user_id != ?";
    const params = [user.role, user.id];
    if (['leader', 'manager'].includes(user.role)) {
      where += ' AND a.approver_id = ?';
      params.push(user.id);
    } else {
      where += ' AND (a.approver_id IS NULL OR a.approver_id = ?)';
      params.push(user.id);
    }
    const rows = await db.prepare(`
      SELECT r.*, u.full_name, u.employee_code, u.department_id, d.name AS department_name,
             lt.name AS leave_type_name, lt.code AS leave_type_code, lt.annual_quota
      FROM leave_requests r
      JOIN approvals a ON a.request_id = r.id
      JOIN users u ON u.id = r.user_id
      LEFT JOIN departments d ON d.id = u.department_id
      JOIN leave_types lt ON lt.id = r.leave_type_id
      WHERE ${where}
      ORDER BY r.created_at
    `).all(...params);
    const historyRows = await db.prepare(`
      SELECT r.*, u.full_name, u.employee_code, u.department_id, d.name AS department_name,
             lt.name AS leave_type_name, lt.code AS leave_type_code, lt.annual_quota,
             a.action AS decision_action, a.note AS decision_note, a.acted_at AS decision_at
      FROM approvals a
      JOIN leave_requests r ON r.id = a.request_id
      JOIN users u ON u.id = r.user_id
      LEFT JOIN departments d ON d.id = u.department_id
      JOIN leave_types lt ON lt.id = r.leave_type_id
      WHERE a.approver_id = ? AND a.action IN ('approved', 'rejected')
      ORDER BY a.acted_at DESC, a.id DESC
      LIMIT 100
    `).all(user.id);
    const history = await serializeRequests(historyRows);
    history.forEach((item, index) => {
      item.decisionAction = historyRows[index].decision_action;
      item.decisionNote = historyRows[index].decision_note || '';
      item.decisionAt = historyRows[index].decision_at;
    });
    return json(res, 200, { items: await serializeRequests(rows), history });
  }

  const decisionMatch = pathname.match(/^\/api\/requests\/(\d+)\/decision$/);
  if (method === 'POST' && decisionMatch) {
    const user = await requireAuth(req, res, ['leader', 'manager', 'hr', 'admin']);
    if (!user) return true;
    const body = await readBody(req);
    const action = body.action === 'approve'
      ? 'approve'
      : body.action === 'reject' ? 'reject' : '';
    const note = String(body.note || '').trim();
    if (!action) return fail(res, 400, 'Quyết định không hợp lệ.');
    if (action === 'reject' && !note) {
      return fail(res, 400, 'Vui lòng nhập lý do từ chối.');
    }

    const row = await getRequest(Number(decisionMatch[1]));
    if (!row) return fail(res, 404, 'Không tìm thấy đơn nghỉ phép.');
    const approval = await db.prepare(`
      SELECT * FROM approvals
      WHERE request_id = ? AND action = 'pending'
      ORDER BY step
      LIMIT 1
    `).get(row.id);
    if (!approval || row.status !== `pending_${approval.approver_role}`) {
      return fail(res, 409, 'Đơn đã được xử lý hoặc chưa đến bước của bạn.');
    }
    if (approval.approver_role !== user.role) {
      return fail(res, 403, 'Đơn chưa đến cấp duyệt của bạn.');
    }
    if (row.user_id === user.id) {
      return fail(res, 403, 'Bạn không thể tự duyệt đơn của chính mình.');
    }
    if (approval.approver_id && approval.approver_id !== user.id) {
      return fail(res, 403, 'Đơn này đã được phân công cho người quản lý khác.');
    }
    if (!approval.approver_id && ['leader', 'manager'].includes(user.role)) {
      return fail(res, 409, 'Cấp duyệt này chưa được phân công người phụ trách.');
    }

    const item = await db.transaction(async (client) => {
      await client.prepare(`
        UPDATE approvals SET approver_id = ?, action = ?, note = ?, acted_at = ?
        WHERE request_id = ? AND step = ?
      `).run(
        user.id,
        action === 'approve' ? 'approved' : 'rejected',
        note,
        new Date(),
        row.id,
        approval.step
      );

      let nextStatus;
      let nextApproval = null;
      if (action === 'reject') {
        nextStatus = `rejected_by_${user.role}`;
      } else {
        nextApproval = await client.prepare(`
          SELECT * FROM approvals
          WHERE request_id = ? AND step > ?
          ORDER BY step
          LIMIT 1
        `).get(row.id, approval.step);
        if (nextApproval) {
          nextStatus = `pending_${nextApproval.approver_role}`;
          await client.prepare(`
            UPDATE approvals SET action = 'pending' WHERE request_id = ? AND step = ?
          `).run(row.id, nextApproval.step);
        } else {
          nextStatus = 'approved';
        }
      }

      await client.prepare(`
        UPDATE leave_requests
        SET status = ?, current_step = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        nextStatus,
        nextApproval ? nextApproval.step : approval.step,
        row.id
      );

      if (nextStatus === 'approved' && row.annual_quota > 0) {
        const year = Number(row.start_date.slice(0, 4));
        await ensureBalance(row.user_id, row.leave_type_id, year, client);
        await client.prepare(`
          UPDATE leave_balances SET used = used + ?
          WHERE user_id = ? AND leave_type_id = ? AND year = ?
        `).run(row.days, row.user_id, row.leave_type_id, year);
      }

      const decisionText = action === 'approve' ? 'Phê duyệt' : 'Từ chối';
      await logAudit(
        user,
        decisionText,
        `${decisionText} đơn ${row.request_code}${note ? `: ${note}` : ''}`,
        ipOf(req),
        client
      );
      await notify(
        row.user_id,
        `Đơn ${row.request_code}: ${STATUS_LABELS[nextStatus]}`,
        action === 'approve'
          ? `${user.fullName} đã phê duyệt đơn của bạn.`
          : `${user.fullName} đã từ chối: ${note}`,
        'requests',
        client
      );
      if (action === 'approve' && nextApproval) {
        if (nextApproval.approver_id) {
          await notify(
            nextApproval.approver_id,
            `Đơn ${row.request_code} chờ duyệt`,
            `${row.full_name} gửi đơn ${row.leave_type_name}.`,
            'approvals',
            client
          );
        } else {
          await notifyRole(
            nextApproval.approver_role,
            row.department_id,
            `Đơn ${row.request_code} chờ duyệt`,
            `${row.full_name} gửi đơn ${row.leave_type_name}.`,
            'approvals',
            client
          );
        }
      }
      return serializeRequest(await getRequest(row.id, client), true, client);
    });
    return json(res, 200, { item });
  }

  return false;
}

module.exports = handleRequests;
