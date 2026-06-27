function adminTabs() {
  return `<div class="tabs">
    ${[
      ['accounts', 'Tài khoản'],
      ['departments', 'Phòng ban'],
      ['permissions', 'Phân quyền'],
      ['audit', 'Audit Log']
    ].map(([id, label]) => `<button class="tab ${state.adminTab === id ? 'active' : ''}" data-admin-tab="${id}">${label}</button>`).join('')}
  </div>`;
}

async function renderAdmin() {
  $('#page-content').innerHTML = `${pageHeading('Quản trị hệ thống', 'Tài khoản, cấu trúc tổ chức và kiểm soát truy cập')}${adminTabs()}<div id="admin-content"></div>`;
  $$('[data-admin-tab]').forEach((button) => button.addEventListener('click', () => {
    state.adminTab = button.dataset.adminTab;
    renderAdmin();
  }));
  const target = $('#admin-content');
  if (state.adminTab === 'accounts') await renderEmployees(target, true);
  if (state.adminTab === 'departments') await renderDepartments(target);
  if (state.adminTab === 'permissions') renderPermissions(target);
  if (state.adminTab === 'audit') await renderAudit(target);
}

async function renderDepartments(target) {
  const { items } = await api('/api/departments');
  state.departments = items;
  target.innerHTML = `
    <div class="toolbar"><button id="add-department" class="btn btn-primary filters-end">＋ Thêm phòng ban</button></div>
    <div class="alert alert-info">Mỗi phòng ban có thể chỉ định một trưởng nhóm và một trưởng phòng. Người được chọn phải có đúng chức vụ và đang thuộc phòng đó.</div>
    <section class="card">${table(
      ['Mã', 'Tên phòng ban', 'Trưởng nhóm', 'Trưởng phòng', 'Thành viên', ''],
      items.map((item) => [
        `<strong>${esc(item.code)}</strong>`,
        esc(item.name),
        item.leader ? `<span class="badge badge-info">${esc(item.leader)}</span>` : '<span class="badge badge-warning">Chưa chỉ định</span>',
        item.manager ? `<span class="badge badge-purple">${esc(item.manager)}</span>` : '<span class="badge badge-danger">Chưa chỉ định</span>',
        `${item.activeMembers} hoạt động`,
        `<div class="table-actions"><button class="btn btn-outline btn-small edit-department" data-id="${item.id}">Sửa</button>
        <button class="btn btn-danger btn-small delete-department" data-id="${item.id}">Xóa</button></div>`
      ])
    )}</section>
    <div class="organization-grid">
      ${items.map((item) => `
        <section class="organization-card">
          <div class="organization-card-head">
            <div><span>${esc(item.code)}</span><h3>${esc(item.name)}</h3></div>
            <strong>${item.activeMembers} người</strong>
          </div>
          <div class="organization-roles">
            <div><small>Trưởng phòng</small><strong>${esc(item.manager || 'Chưa chỉ định')}</strong></div>
            <div><small>Trưởng nhóm</small><strong>${esc(item.leader || 'Chưa chỉ định')}</strong></div>
          </div>
          <div class="organization-members">
            ${item.people.length ? item.people.map((person) => `
              <div class="${person.active ? '' : 'inactive'}">
                <span class="avatar">${esc(initials(person.fullName))}</span>
                <span><strong>${esc(person.fullName)}</strong><small>${esc(person.employeeCode)} · ${esc(ROLE_LABELS[person.role] || person.role)}</small></span>
              </div>
            `).join('') : '<p class="form-hint">Chưa có nhân sự trong phòng ban.</p>'}
          </div>
        </section>
      `).join('')}
    </div>`;
  $('#add-department').addEventListener('click', () => openDepartmentForm());
  $$('.edit-department').forEach((button) => button.addEventListener('click', () => openDepartmentForm(items.find((item) => item.id === Number(button.dataset.id)))));
  $$('.delete-department').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Xóa phòng ban này?')) return;
    try {
      await api(`/api/departments/${button.dataset.id}`, { method: 'DELETE' });
      toast('Đã xóa phòng ban.');
      await navigate('admin', false);
    } catch (error) {
      toast(error.message, true);
    }
  }));
}

function openDepartmentForm(item = null) {
  const leaders = item?.people.filter((person) => person.role === 'leader' && person.active) || [];
  const managers = item?.people.filter((person) => person.role === 'manager' && person.active) || [];
  openModal({
    title: item ? `Cập nhật ${item.name}` : 'Thêm phòng ban',
    body: `<div class="form-grid">
      <div class="form-group"><label class="field-label">Mã phòng ban</label><input id="department-code" class="input" value="${esc(item?.code || '')}"></div>
      <div class="form-group"><label class="field-label">Tên phòng ban</label><input id="department-name" class="input" value="${esc(item?.name || '')}"></div>
      ${item ? `
        <div class="form-group"><label class="field-label">Trưởng nhóm phụ trách</label><select id="department-leader" class="input">
          <option value="">Chưa chỉ định</option>
          ${leaders.map((person) => `<option value="${person.id}" ${person.id === item.leaderId ? 'selected' : ''}>${esc(person.fullName)} · ${esc(person.employeeCode)}</option>`).join('')}
        </select></div>
        <div class="form-group"><label class="field-label">Trưởng phòng phụ trách</label><select id="department-manager" class="input">
          <option value="">Chưa chỉ định</option>
          ${managers.map((person) => `<option value="${person.id}" ${person.id === item.managerId ? 'selected' : ''}>${esc(person.fullName)} · ${esc(person.employeeCode)}</option>`).join('')}
        </select></div>
        <div class="form-group full"><span class="form-hint">Nếu danh sách trống, hãy vào tab Tài khoản, đặt đúng chức vụ và phòng ban cho nhân sự trước.</span></div>
      ` : '<div class="form-group full"><span class="form-hint">Sau khi tạo phòng, thêm nhân sự rồi quay lại để chỉ định người phụ trách.</span></div>'}
    </div>`,
    footer: '<button class="btn btn-outline" data-close-modal>Hủy</button><button id="save-department" class="btn btn-primary">Lưu</button>'
  });
  $('[data-close-modal]').addEventListener('click', closeModal);
  $('#save-department').addEventListener('click', async () => {
    try {
      await api(item ? `/api/departments/${item.id}` : '/api/departments', {
        method: item ? 'PUT' : 'POST',
        body: {
          code: $('#department-code').value.trim(),
          name: $('#department-name').value.trim(),
          leaderId: item ? Number($('#department-leader').value || 0) : undefined,
          managerId: item ? Number($('#department-manager').value || 0) : undefined
        }
      });
      closeModal();
      toast('Đã lưu phòng ban.');
      await navigate('admin', false);
    } catch (error) {
      toast(error.message, true);
    }
  });
}

function renderPermissions(target) {
  const permissions = [
    ['Tạo và xem đơn của mình', true, true, true, true, false],
    ['Duyệt cấp trưởng nhóm', false, true, false, false, false],
    ['Duyệt cấp trưởng phòng', false, false, true, false, false],
    ['Xác nhận HR', false, false, false, true, false],
    ['Xem lịch nghỉ phòng ban', true, true, true, true, true],
    ['Quản lý nhân sự', false, false, false, true, true],
    ['Quản lý tài khoản/phòng ban', false, false, false, false, true],
    ['Xem báo cáo', false, false, true, true, true],
    ['Xem nhật ký hệ thống', false, false, false, false, true]
  ];
  target.innerHTML = `<div class="alert alert-info">Ma trận này phản ánh quyền được thực thi ở máy chủ; không chỉ là ẩn/hiện nút trên giao diện.</div>
    <section class="card">${table(
      ['Chức năng', 'Nhân viên', 'Trưởng nhóm', 'Trưởng phòng', 'HR', 'Admin'],
      permissions.map((row) => [esc(row[0]), ...row.slice(1).map((allowed) => allowed ? '<span class="badge badge-success">Có</span>' : '<span class="badge badge-muted">Không</span>')])
    )}</section>`;
}

async function renderAudit(target) {
  const { items } = await api('/api/audit-logs');
  target.innerHTML = `<section class="card">${table(
    ['Thời gian', 'Tài khoản', 'Hành động', 'Chi tiết', 'IP'],
    items.map((item) => [
      formatDateTime(item.createdAt), `<strong>${esc(item.username)}</strong>`,
      `<span class="badge badge-info">${esc(item.action)}</span>`, esc(item.detail), `<code>${esc(item.ip || '—')}</code>`
    ])
  )}</section>`;
}

async function renderReports() {
  const { year, departments, monthly, types } = await api(`/api/reports?year=${state.reportYear}`);
  const years = [year - 1, year, year + 1];
  $('#page-content').innerHTML = `
    ${pageHeading('Báo cáo nghỉ phép', 'Thống kê đơn và số ngày nghỉ đã được phê duyệt',
      `<select id="report-year" class="input compact">${years.map((item) => `<option ${item === state.reportYear ? 'selected' : ''}>${item}</option>`).join('')}</select>
      <button id="export-report" class="btn btn-outline">⇩ Xuất CSV</button>`)}
    <div class="grid two">
      <section class="card"><div class="card-header"><div><h3>Ngày nghỉ theo tháng</h3><p>Năm ${year}</p></div></div><div class="card-body">${monthlyChart(monthly)}</div></section>
      <section class="card"><div class="card-header"><div><h3>Cơ cấu loại phép</h3><p>Số lượng đơn</p></div></div><div class="card-body">${donutChart(types)}</div></section>
    </div>
    <section class="card">
      <div class="card-header"><div><h3>Thống kê theo phòng ban</h3><p>Tỷ lệ duyệt và tổng ngày nghỉ</p></div></div>
      ${table(
        ['Phòng ban', 'Tổng đơn', 'Đã duyệt', 'Từ chối', 'Đang chờ', 'Ngày nghỉ', 'Tỷ lệ duyệt'],
        departments.map((item) => [
          `<strong>${esc(item.name)}</strong>`, item.total, item.approved, item.rejected, item.pending,
          `${item.days} ngày`, `${item.total ? Math.round(item.approved / item.total * 100) : 0}%`
        ])
      )}
    </section>`;
  $('#report-year').addEventListener('change', (event) => {
    state.reportYear = Number(event.target.value);
    renderReports();
  });
  $('#export-report').addEventListener('click', () => downloadFile(`/api/export/reports?year=${state.reportYear}`));
}

async function renderPolicies() {
  const [types, holidays] = await Promise.all([api('/api/leave-types'), api('/api/holidays')]);
  $('#page-content').innerHTML = `
    ${pageHeading('Quy định nghỉ phép', 'Thông tin tham khảo từ cấu hình đang áp dụng')}
    <div class="grid equal">
      <section class="card">
        <div class="card-header"><div><h3>Các loại nghỉ phép</h3><p>Hạn mức và yêu cầu minh chứng</p></div></div>
        <div class="card-body"><div class="policy-list">${types.items.map((item, index) => `
          <div class="policy-item">
            <span class="policy-number">${index + 1}</span>
            <div><h3>${esc(item.name)} · ${item.annualQuota || 'Không giới hạn'} ngày/năm</h3>
            <p>${esc(item.description)} ${item.requiresProof ? 'Có yêu cầu minh chứng.' : ''}</p></div>
          </div>
        `).join('')}</div></div>
      </section>
      <section class="card">
        <div class="card-header"><div><h3>Lịch nghỉ lễ</h3><p>Các ngày được loại khỏi phép làm việc</p></div></div>
        ${table(['Ngày lễ', 'Từ ngày', 'Đến ngày', 'Số ngày'], holidays.items.map((item) => [
          `<strong>${esc(item.name)}</strong>`, formatDate(item.startDate), formatDate(item.endDate), `${item.days} ngày`
        ]))}
      </section>
    </div>
    <div class="alert alert-warning">Luồng duyệt phụ thuộc chức vụ: nhân viên đi qua cấp quản lý của phòng rồi HR; trưởng nhóm bắt đầu từ trưởng phòng; trưởng phòng chuyển thẳng HR; đơn của HR do quản trị viên xác nhận. Không ai được tự duyệt đơn của mình.</div>`;
}

async function renderProfile() {
  const user = state.user;
  $('#page-content').innerHTML = `
    ${pageHeading('Hồ sơ cá nhân', 'Cập nhật thông tin liên hệ và bảo mật tài khoản')}
    <div class="profile-card">
      <span class="avatar">${esc(user.avatar)}</span>
      <div><h2>${esc(user.fullName)}</h2><p>${esc(user.roleLabel)} · ${esc(user.department)} · ${esc(user.employeeCode)}</p>
      ${user.isDepartmentManager ? '<span class="badge badge-purple">Trưởng phòng được phân công</span>' : ''}
      ${user.isDepartmentLeader ? '<span class="badge badge-info">Trưởng nhóm được phân công</span>' : ''}</div>
    </div>
    <div class="grid equal">
      <section class="card">
        <div class="card-header"><div><h3>Thông tin cá nhân</h3><p>Tên, email và số điện thoại</p></div></div>
        <div class="card-body">
          <form id="profile-form">
            <label class="field-label">Họ và tên</label><input id="profile-name" class="input" value="${esc(user.fullName)}">
            <label class="field-label">Email</label><input id="profile-email" class="input" type="email" value="${esc(user.email)}">
            <label class="field-label">Số điện thoại</label><input id="profile-phone" class="input" value="${esc(user.phone)}">
            <button class="btn btn-primary" type="submit">Lưu thông tin</button>
          </form>
        </div>
      </section>
      <section class="card">
        <div class="card-header"><div><h3>Đổi mật khẩu</h3><p>Mật khẩu mới cần ít nhất 6 ký tự</p></div></div>
        <div class="card-body">
          <form id="password-form">
            <label class="field-label">Mật khẩu hiện tại</label><input id="current-password" class="input" type="password">
            <label class="field-label">Mật khẩu mới</label><input id="new-password" class="input" type="password">
            <label class="field-label">Nhập lại mật khẩu mới</label><input id="confirm-password" class="input" type="password">
            <button class="btn btn-primary" type="submit">Đổi mật khẩu</button>
          </form>
        </div>
      </section>
    </div>`;
  $('#profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/profile', {
        method: 'PUT',
        body: { fullName: $('#profile-name').value.trim(), email: $('#profile-email').value.trim(), phone: $('#profile-phone').value.trim() }
      });
      const { user: refreshed } = await api('/api/auth/me');
      state.user = refreshed;
      showApp(refreshed);
      toast('Đã cập nhật hồ sơ.');
    } catch (error) {
      toast(error.message, true);
    }
  });
  $('#password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentPassword = $('#current-password').value;
    const newPassword = $('#new-password').value;
    if (newPassword !== $('#confirm-password').value) return toast('Mật khẩu nhập lại không khớp.', true);
    try {
      await api('/api/profile/password', { method: 'PUT', body: { currentPassword, newPassword } });
      event.target.reset();
      toast('Đã đổi mật khẩu.');
    } catch (error) {
      toast(error.message, true);
    }
  });
}

