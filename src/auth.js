const crypto = require('node:crypto');
const { db } = require('../db');
const { fail } = require('./http');
const { ROLE_LABELS } = require('./constants');

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function ipOf(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

function initials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

function publicUser(row) {
  return {
    id: row.id,
    employeeCode: row.employee_code,
    username: row.username,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role],
    departmentId: row.department_id,
    department: row.department_name || '',
    startDate: row.start_date,
    active: Boolean(row.active),
    avatar: row.avatar || initials(row.full_name)
  };
}

async function currentUser(req) {
  const token = parseCookies(req).leave_session;
  if (!token) return null;
  const row = await db.prepare(`
    SELECT u.*, d.name AS department_name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.active = 1
  `).get(tokenHash(token));
  return row ? publicUser(row) : null;
}

async function requireAuth(req, res, roles = null) {
  const user = await currentUser(req);
  if (!user) {
    fail(res, 401, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    return null;
  }
  if (roles && !roles.includes(user.role)) {
    fail(res, 403, 'Bạn không có quyền thực hiện thao tác này.');
    return null;
  }
  return user;
}

module.exports = {
  parseCookies,
  tokenHash,
  ipOf,
  initials,
  publicUser,
  requireAuth
};
