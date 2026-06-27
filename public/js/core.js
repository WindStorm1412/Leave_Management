const state = {
  user: null,
  page: 'dashboard',
  notifications: [],
  requests: [],
  leaveTypes: [],
  hrTab: 'employees',
  adminTab: 'accounts',
  balanceYear: new Date().getFullYear(),
  hrBalanceYear: new Date().getFullYear(),
  reportYear: new Date().getFullYear()
};

const PAGE_META = {
  dashboard: ['Dashboard', 'Tổng quan hệ thống'],
  requests: ['Đơn nghỉ phép', 'Quản lý và theo dõi đơn của tôi'],
  balance: ['Số ngày phép', 'Theo dõi hạn mức và lịch sử sử dụng'],
  approvals: ['Đơn chờ duyệt', 'Xử lý đơn theo cấp phê duyệt'],
  calendar: ['Lịch nghỉ', 'Theo dõi lịch vắng mặt của phòng ban'],
  hr: ['Quản lý nhân sự', 'Nhân viên, loại phép, số dư và ngày lễ'],
  admin: ['Quản trị hệ thống', 'Tài khoản, phòng ban và nhật ký'],
  reports: ['Báo cáo & Thống kê', 'Phân tích tình hình nghỉ phép'],
  policies: ['Quy định nghỉ phép', 'Chính sách và ngày nghỉ lễ'],
  profile: ['Hồ sơ cá nhân', 'Thông tin tài khoản của bạn']
};

const STATUS_CLASS = {
  pending_leader: 'badge-warning',
  pending_manager: 'badge-info',
  pending_hr: 'badge-purple',
  approved: 'badge-success',
  rejected_by_leader: 'badge-danger',
  rejected_by_manager: 'badge-danger',
  rejected_by_hr: 'badge-danger',
  cancelled: 'badge-muted'
};

const ROLE_LABELS = {
  employee: 'Nhân viên',
  leader: 'Trưởng nhóm',
  manager: 'Trưởng phòng',
  hr: 'Nhân sự HR',
  admin: 'Quản trị viên'
};

const NAV = {
  employee: [
    ['Chính', [
      ['dashboard', '▦', 'Dashboard'],
      ['requests', '▤', 'Đơn của tôi'],
      ['balance', '◫', 'Số ngày phép']
    ]],
    ['Thông tin', [
      ['calendar', '▦', 'Lịch nghỉ phòng'],
      ['policies', '◇', 'Quy định nghỉ phép'],
      ['profile', '○', 'Hồ sơ cá nhân']
    ]]
  ],
  leader: [
    ['Chính', [
      ['dashboard', '▦', 'Dashboard'],
      ['approvals', '✓', 'Đơn chờ duyệt'],
      ['requests', '▤', 'Đơn của tôi'],
      ['balance', '◫', 'Số ngày phép']
    ]],
    ['Quản lý nhóm', [
      ['calendar', '▦', 'Lịch nghỉ nhóm'],
      ['policies', '◇', 'Quy định'],
      ['profile', '○', 'Hồ sơ cá nhân']
    ]]
  ],
  manager: [
    ['Chính', [
      ['dashboard', '▦', 'Dashboard'],
      ['approvals', '✓', 'Đơn chờ duyệt'],
      ['requests', '▤', 'Đơn của tôi'],
      ['balance', '◫', 'Số ngày phép']
    ]],
    ['Quản lý', [
      ['calendar', '▦', 'Lịch nghỉ phòng'],
      ['reports', '▥', 'Báo cáo'],
      ['policies', '◇', 'Quy định'],
      ['profile', '○', 'Hồ sơ cá nhân']
    ]]
  ],
  hr: [
    ['Chính', [
      ['dashboard', '▦', 'Dashboard'],
      ['approvals', '✓', 'Đơn chờ xác nhận'],
      ['requests', '▤', 'Đơn của tôi'],
      ['balance', '◫', 'Số ngày phép']
    ]],
    ['Nhân sự', [
      ['hr', '♙', 'Quản lý nhân sự'],
      ['calendar', '▦', 'Lịch nghỉ toàn công ty'],
      ['reports', '▥', 'Báo cáo'],
      ['policies', '◇', 'Quy định'],
      ['profile', '○', 'Hồ sơ cá nhân']
    ]]
  ],
  admin: [
    ['Hệ thống', [
      ['dashboard', '▦', 'Dashboard'],
      ['admin', '⚙', 'Quản trị hệ thống'],
      ['hr', '♙', 'Quản lý nhân sự'],
      ['calendar', '▦', 'Lịch nghỉ'],
      ['reports', '▥', 'Báo cáo'],
      ['policies', '◇', 'Quy định'],
      ['profile', '○', 'Hồ sơ cá nhân']
    ]]
  ]
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const THEME_KEY = 'leave-system-theme';

function getStoredTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function updateThemeButtons(theme) {
  const isDark = theme === 'dark';
  $$('.theme-toggle').forEach((button) => {
    button.setAttribute('aria-pressed', String(isDark));
    button.setAttribute('aria-label', isDark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối');
    const icon = $('.theme-icon', button);
    const label = $('.theme-label', button);
    if (icon) icon.textContent = isDark ? '☀' : '☾';
    if (label) label.textContent = isDark ? 'Light' : 'Dark';
  });
}

function applyTheme(theme) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', nextTheme === 'dark' ? '#070b14' : '#2563eb');
  updateThemeButtons(nextTheme);
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const nextTheme = current === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(THEME_KEY, nextTheme);
  } catch {
    // Theme still changes for the current session even if localStorage is unavailable.
  }
  applyTheme(nextTheme);
}

applyTheme(getStoredTheme());

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return '—';
  const raw = String(value).slice(0, 10);
  const [year, month, day] = raw.split('-');
  return year && month && day ? `${day}/${month}/${year}` : esc(value);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(date.getTime())) return esc(value);
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function initials(name) {
  return String(name || '').trim().split(/\s+/).slice(-2).map((part) => part[0]).join('').toUpperCase();
}

function statusBadge(item) {
  return `<span class="badge ${STATUS_CLASS[item.status] || 'badge-dark'}">${esc(item.statusLabel || item.status)}</span>`;
}

function activeBadge(active) {
  return `<span class="badge ${active ? 'badge-success' : 'badge-danger'}">${active ? 'Hoạt động' : 'Đã khóa'}</span>`;
}

function roleBadge(role) {
  return `<span class="badge badge-info">${esc(ROLE_LABELS[role] || role)}</span>`;
}

function emptyState(message = 'Chưa có dữ liệu') {
  return `<div class="empty-state"><div><span class="empty-icon">□</span>${esc(message)}</div></div>`;
}

function table(headers, rows) {
  if (!rows.length) return emptyState('Không có dữ liệu phù hợp');
  return `<div class="table-wrap"><table class="data-table">
    <thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

function pageHeading(title, subtitle, actions = '') {
  return `<div class="page-heading">
    <div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ''}
  </div>`;
}

async function api(url, options = {}) {
  const config = {
    method: options.method || 'GET',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    credentials: 'same-origin',
    body: options.body ? JSON.stringify(options.body) : undefined
  };
  const response = await fetch(url, config);
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    if (response.status === 401 && state.user) showLogin();
    throw new Error(data.error || 'Không thể kết nối máy chủ.');
  }
  return data;
}

function toast(message, error = false) {
  const item = document.createElement('div');
  item.className = `toast${error ? ' error' : ''}`;
  item.textContent = message;
  $('#toast-region').append(item);
  setTimeout(() => item.remove(), 3300);
}

function downloadFile(url) {
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
}

function setLoading() {
  $('#page-content').innerHTML = '<div class="loading-state"><span class="spinner"></span> Đang tải dữ liệu...</div>';
}

function showLogin() {
  state.user = null;
  $('#app').hidden = true;
  $('#login-screen').hidden = false;
  $('#notification-panel').classList.remove('open');
}

function showApp(user) {
  state.user = user;
  $('#login-screen').hidden = true;
  $('#app').hidden = false;
  $('#user-name').textContent = user.fullName;
  $('#user-role').textContent = `${user.roleLabel} · ${user.department || 'Chưa có phòng ban'}`;
  $('#user-avatar').textContent = user.avatar || initials(user.fullName);
  $('#topbar-avatar').textContent = user.avatar || initials(user.fullName);
  $('#topbar-name').textContent = user.fullName;
  renderNav();
  loadNotifications();
  const requested = location.hash.replace('#/', '');
  const allowed = NAV[user.role].flatMap((section) => section[1].map((item) => item[0]));
  navigate(allowed.includes(requested) ? requested : 'dashboard', false);
}

function renderNav() {
  const sections = NAV[state.user.role] || NAV.employee;
  $('#nav-menu').innerHTML = sections.map(([label, items]) => `
    <div class="nav-section-title">${esc(label)}</div>
    ${items.map(([page, icon, text]) => `
      <button class="nav-link ${state.page === page ? 'active' : ''}" data-page="${page}">
        <span class="nav-icon">${icon}</span>
        <span>${esc(text)}</span>
        ${page === 'approvals' ? '<span id="approval-nav-badge" class="nav-badge" hidden>0</span>' : ''}
      </button>
    `).join('')}
  `).join('');
  $$('.nav-link').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.page)));
  if (['leader', 'manager', 'hr'].includes(state.user.role)) updateApprovalBadge();
}

async function updateApprovalBadge() {
  try {
    const { items } = await api('/api/approvals');
    const badge = $('#approval-nav-badge');
    if (!badge) return;
    badge.textContent = items.length;
    badge.hidden = !items.length;
  } catch {
    // Badge is supplementary; page-level errors remain visible.
  }
}

function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#sidebar-overlay').classList.remove('open');
}

async function navigate(page, updateHash = true) {
  state.page = page;
  if (updateHash) history.replaceState(null, '', `#/${page}`);
  renderNav();
  closeSidebar();
  const [title, breadcrumb] = PAGE_META[page] || ['', ''];
  $('#page-title').textContent = title;
  $('#page-breadcrumb').textContent = breadcrumb;
  setLoading();
  try {
    const renderer = {
      dashboard: renderDashboard,
      requests: renderRequests,
      balance: renderBalance,
      approvals: renderApprovals,
      calendar: renderCalendar,
      hr: renderHR,
      admin: renderAdmin,
      reports: renderReports,
      policies: renderPolicies,
      profile: renderProfile
    }[page];
    if (!renderer) throw new Error('Trang không tồn tại.');
    await renderer();
  } catch (error) {
    $('#page-content').innerHTML = `<div class="card"><div class="empty-state"><div><span class="empty-icon">!</span>${esc(error.message)}</div></div></div>`;
  }
}

function statCard(value, label, icon, tone) {
  return `<div class="stat-card stat-${esc(tone)}">
    <div class="stat-icon">${icon}</div>
    <div><div class="stat-value">${esc(value)}</div><div class="stat-label">${esc(label)}</div></div>
  </div>`;
}

function monthlyChart(items) {
  const values = Array.from({ length: 12 }, (_, index) => items.find((item) => item.month === index + 1)?.days || 0);
  const max = Math.max(...values, 1);
  return `<div class="chart">${values.map((value, index) => `
    <div class="bar-item">
      <span class="bar-value">${value || ''}</span>
      <span class="bar" style="height:${Math.max(3, value / max * 155)}px"></span>
      <span class="bar-label">T${index + 1}</span>
    </div>
  `).join('')}</div>`;
}

function donutChart(items) {
  const colors = ['#2563eb', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4'];
  const total = items.reduce((sum, item) => sum + Number(item.total), 0);
  let cursor = 0;
  const stops = items.map((item, index) => {
    const start = cursor;
    cursor += total ? Number(item.total) / total * 100 : 0;
    return `${colors[index % colors.length]} ${start}% ${cursor}%`;
  });
  return `<div class="donut-layout">
    <div class="donut" data-total="${total}" style="background:conic-gradient(${stops.length ? stops.join(',') : 'var(--chart-empty) 0 100%'})"></div>
    <div class="legend">${items.length ? items.map((item, index) => `
      <div class="legend-item">
        <span class="legend-dot" style="background:${colors[index % colors.length]}"></span>
        <span>${esc(item.name)}</span><strong>${item.total}</strong>
      </div>
    `).join('') : '<span class="form-hint">Chưa có dữ liệu</span>'}</div>
  </div>`;
}

function requestRows(items, actions = 'view') {
  return items.map((item) => [
    `<button class="btn btn-soft btn-small request-detail" data-id="${item.id}">${esc(item.code)}</button>`,
    `<div class="cell-user"><span class="avatar">${esc(initials(item.employeeName))}</span><div><strong>${esc(item.employeeName)}</strong><small>${esc(item.department)}</small></div></div>`,
    esc(item.leaveType),
    `${formatDate(item.startDate)} – ${formatDate(item.endDate)}`,
    `<strong>${item.days}</strong> ngày`,
    statusBadge(item),
    actions === 'approve'
      ? `<div class="table-actions">
          <button class="btn btn-outline btn-small request-detail" data-id="${item.id}">Chi tiết</button>
          <button class="btn btn-success btn-small request-decision" data-id="${item.id}" data-action="approve">Duyệt</button>
          <button class="btn btn-danger btn-small request-decision" data-id="${item.id}" data-action="reject">Từ chối</button>
        </div>`
      : `<button class="btn btn-outline btn-small request-detail" data-id="${item.id}">Xem</button>`
  ]);
}

function bindRequestActions(root = document) {
  $$('.request-detail', root).forEach((button) => button.addEventListener('click', () => showRequestDetail(button.dataset.id)));
  $$('.request-decision', root).forEach((button) => button.addEventListener('click', () => openDecision(button.dataset.id, button.dataset.action)));
}

