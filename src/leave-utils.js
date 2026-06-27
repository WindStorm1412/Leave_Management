const { db } = require('../db');
const { ROLE_LABELS, STATUS_LABELS } = require('./constants');

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function datesBetween(start, end) {
  const dates = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

async function calculateBusinessDays(start, end) {
  const holidays = await db.prepare(`
    SELECT start_date, end_date FROM holidays
    WHERE end_date >= ? AND start_date <= ?
  `).all(start, end);
  const holidaySet = new Set();
  holidays.forEach((holiday) => {
    datesBetween(holiday.start_date, holiday.end_date).forEach((date) => holidaySet.add(date));
  });
  return datesBetween(start, end).filter((date) => {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    return day !== 0 && day !== 6 && !holidaySet.has(date);
  }).length;
}

async function getRequest(id, client = db) {
  return client.prepare(`
    SELECT r.*, u.full_name, u.employee_code, u.department_id, d.name AS department_name,
           lt.name AS leave_type_name, lt.code AS leave_type_code, lt.annual_quota
    FROM leave_requests r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN departments d ON d.id = u.department_id
    JOIN leave_types lt ON lt.id = r.leave_type_id
    WHERE r.id = ?
  `).get(id);
}

async function serializeRequest(row, includeApprovals = false, client = db) {
  const item = {
    id: row.id,
    code: row.request_code,
    userId: row.user_id,
    employeeCode: row.employee_code,
    employeeName: row.full_name,
    departmentId: row.department_id,
    department: row.department_name || '',
    leaveTypeId: row.leave_type_id,
    leaveTypeCode: row.leave_type_code,
    leaveType: row.leave_type_name,
    startDate: row.start_date,
    endDate: row.end_date,
    days: row.days,
    reason: row.reason,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    currentStep: row.current_step,
    attachmentName: row.attachment_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (includeApprovals) {
    const approvals = await client.prepare(`
      SELECT a.step, a.approver_role, a.action, a.note, a.acted_at,
             u.full_name AS approver_name
      FROM approvals a
      LEFT JOIN users u ON u.id = a.approver_id
      WHERE a.request_id = ?
      ORDER BY a.step
    `).all(row.id);
    item.approvals = approvals.map((approval) => ({
      step: approval.step,
      role: approval.approver_role,
      roleLabel: ROLE_LABELS[approval.approver_role],
      action: approval.action,
      note: approval.note,
      actedAt: approval.acted_at,
      approverName: approval.approver_name || ''
    }));
  }
  return item;
}

async function serializeRequests(rows, includeApprovals = false, client = db) {
  return Promise.all(rows.map((row) => serializeRequest(row, includeApprovals, client)));
}

async function requestRows(where = '1=1', params = [], limit = 200, client = db) {
  const safeLimit = Number.isInteger(Number(limit))
    ? Math.min(Math.max(Number(limit), 1), 1000)
    : 200;
  return client.prepare(`
    SELECT r.*, u.full_name, u.employee_code, u.department_id, d.name AS department_name,
           lt.name AS leave_type_name, lt.code AS leave_type_code, lt.annual_quota
    FROM leave_requests r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN departments d ON d.id = u.department_id
    JOIN leave_types lt ON lt.id = r.leave_type_id
    WHERE ${where}
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${safeLimit}
  `).all(...params);
}

async function notify(userId, title, body, link = '', client = db) {
  await client.prepare(`
    INSERT INTO notifications (user_id, title, body, link)
    VALUES (?, ?, ?, ?)
  `).run(userId, title, body, link);
}

async function notifyRole(role, departmentId, title, body, link = 'approvals', client = db) {
  let sql = 'SELECT id FROM users WHERE role = ? AND active = 1';
  const params = [role];
  if (departmentId && ['leader', 'manager'].includes(role)) {
    sql += ' AND department_id = ?';
    params.push(departmentId);
  }
  const users = await client.prepare(sql).all(...params);
  for (const user of users) {
    await notify(user.id, title, body, link, client);
  }
}

async function ensureBalance(userId, leaveTypeId, year, client = db) {
  const type = await client.prepare('SELECT annual_quota FROM leave_types WHERE id = ?').get(leaveTypeId);
  await client.prepare(`
    INSERT INTO leave_balances (user_id, leave_type_id, year, allocated)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE id = id
  `).run(userId, leaveTypeId, year, type?.annual_quota || 0);
  return client.prepare(`
    SELECT * FROM leave_balances WHERE user_id = ? AND leave_type_id = ? AND year = ?
  `).get(userId, leaveTypeId, year);
}

function isDuplicateError(error) {
  return error?.code === 'ER_DUP_ENTRY'
    || String(error?.message || '').includes('Duplicate entry');
}

module.exports = {
  validDate,
  datesBetween,
  calculateBusinessDays,
  getRequest,
  serializeRequest,
  serializeRequests,
  requestRows,
  notify,
  notifyRole,
  ensureBalance,
  isDuplicateError
};
