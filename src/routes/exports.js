const { db } = require('../../db');
const { fail } = require('../http');
const { requireAuth } = require('../auth');
const { ROLE_LABELS, STATUS_LABELS } = require('../constants');
const { requestRows, serializeRequests, validDate } = require('../leave-utils');

function csvCell(value) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvResponse(res, filename, headers, rows) {
  const content = [
    headers.map(csvCell).join(','),
    ...rows.map((row) => row.map(csvCell).join(','))
  ].join('\r\n');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store'
  });
  res.end(`\uFEFF${content}`);
  return true;
}

function stamp() {
  return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}

function applyRequestFilters(where, params, url) {
  const status = url.searchParams.get('status');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const departmentId = Number(url.searchParams.get('departmentId') || 0);
  if (departmentId) {
    where += ' AND u.department_id = ?';
    params.push(departmentId);
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
  return where;
}

async function exportRequests(req, res, url) {
  const user = await requireAuth(req, res);
  if (!user) return true;
  const scope = url.searchParams.get('scope') || 'my';
  let where = 'r.user_id = ?';
  const params = [user.id];

  if (scope === 'all' && ['hr', 'admin'].includes(user.role)) {
    where = '1=1';
    params.length = 0;
  } else if (scope === 'team' && ['leader', 'manager'].includes(user.role)) {
    where = 'u.department_id = ?';
    params[0] = user.departmentId;
  }

  where = applyRequestFilters(where, params, url);
  const items = await serializeRequests(await requestRows(where, params, 1000));
  return csvResponse(res, `leave-requests-${scope}-${stamp()}.csv`, [
    'Mã đơn',
    'Mã nhân viên',
    'Nhân viên',
    'Phòng ban',
    'Loại phép',
    'Từ ngày',
    'Đến ngày',
    'Số ngày',
    'Trạng thái',
    'Lý do',
    'Ngày tạo',
    'Cập nhật cuối'
  ], items.map((item) => [
    item.code,
    item.employeeCode,
    item.employeeName,
    item.department,
    item.leaveType,
    item.startDate,
    item.endDate,
    item.days,
    item.statusLabel,
    item.reason,
    item.createdAt,
    item.updatedAt
  ]));
}

async function exportUsers(req, res) {
  const user = await requireAuth(req, res, ['hr', 'admin']);
  if (!user) return true;
  const rows = await db.prepare(`
    SELECT u.*, d.name AS department_name
    FROM users u
    LEFT JOIN departments d ON d.id = u.department_id
    ORDER BY u.employee_code
  `).all();
  return csvResponse(res, `employees-${stamp()}.csv`, [
    'Mã nhân viên',
    'Tên đăng nhập',
    'Họ tên',
    'Email',
    'Điện thoại',
    'Phòng ban',
    'Vai trò',
    'Ngày vào làm',
    'Trạng thái'
  ], rows.map((row) => [
    row.employee_code,
    row.username,
    row.full_name,
    row.email,
    row.phone,
    row.department_name || '',
    ROLE_LABELS[row.role] || row.role,
    row.start_date,
    row.active ? 'Hoạt động' : 'Đã khóa'
  ]));
}

async function exportBalances(req, res, url) {
  const user = await requireAuth(req, res, ['hr', 'admin']);
  if (!user) return true;
  const year = Number(url.searchParams.get('year') || new Date().getFullYear());
  const rows = await db.prepare(`
    SELECT lb.*, u.employee_code, u.full_name, lt.name AS leave_type_name
    FROM leave_balances lb
    JOIN users u ON u.id = lb.user_id
    JOIN leave_types lt ON lt.id = lb.leave_type_id
    WHERE lb.year = ?
    ORDER BY u.full_name, lt.name
  `).all(year);
  return csvResponse(res, `leave-balances-${year}-${stamp()}.csv`, [
    'Năm',
    'Mã nhân viên',
    'Nhân viên',
    'Loại phép',
    'Được cấp',
    'Điều chỉnh',
    'Đã dùng',
    'Còn lại'
  ], rows.map((row) => [
    row.year,
    row.employee_code,
    row.full_name,
    row.leave_type_name,
    row.allocated,
    row.adjustment,
    row.used,
    Number(row.allocated) + Number(row.adjustment) - Number(row.used)
  ]));
}

async function exportReports(req, res, url) {
  const user = await requireAuth(req, res, ['manager', 'hr', 'admin']);
  if (!user) return true;
  const year = Number(url.searchParams.get('year') || new Date().getFullYear());
  const departmentFilter = user.role === 'manager' ? ' AND d.id = ?' : '';
  const params = user.role === 'manager' ? [year, user.departmentId] : [year];
  const rows = await db.prepare(`
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
  return csvResponse(res, `leave-report-${year}-${stamp()}.csv`, [
    'Năm',
    'Phòng ban',
    'Tổng đơn',
    'Đã duyệt',
    'Từ chối',
    'Đang chờ',
    'Ngày nghỉ',
    'Tỷ lệ duyệt'
  ], rows.map((row) => [
    year,
    row.name,
    row.total,
    row.approved,
    row.rejected,
    row.pending,
    row.days,
    `${row.total ? Math.round(Number(row.approved) / Number(row.total) * 100) : 0}%`
  ]));
}

async function handleExports(req, res, url) {
  if (req.method !== 'GET') return false;
  if (url.pathname === '/api/export/requests') return exportRequests(req, res, url);
  if (url.pathname === '/api/export/users') return exportUsers(req, res, url);
  if (url.pathname === '/api/export/balances') return exportBalances(req, res, url);
  if (url.pathname === '/api/export/reports') return exportReports(req, res, url);
  if (url.pathname.startsWith('/api/export/')) return fail(res, 404, 'Không tìm thấy chức năng xuất dữ liệu.');
  return false;
}

module.exports = handleExports;
