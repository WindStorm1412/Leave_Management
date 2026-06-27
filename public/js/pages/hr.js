function hrTabs() {
  return `<div class="tabs">
    ${[
      ['employees', 'Nhân viên'],
      ['types', 'Loại phép'],
      ['balances', 'Số dư phép'],
      ['holidays', 'Ngày nghỉ lễ'],
      ['all-requests', 'Tất cả đơn']
    ].map(([id, label]) => `<button class="tab ${state.hrTab === id ? 'active' : ''}" data-hr-tab="${id}">${label}</button>`).join('')}
  </div>`;
}

async function renderHR() {
  $('#page-content').innerHTML = `${pageHeading('Quản lý nhân sự', 'Dữ liệu nhân viên và chính sách nghỉ phép')}${hrTabs()}<div id="hr-content"></div>`;
  $$('[data-hr-tab]').forEach((button) => button.addEventListener('click', () => {
    state.hrTab = button.dataset.hrTab;
    renderHR();
  }));
  const target = $('#hr-content');
  if (state.hrTab === 'employees') await renderEmployees(target);
  if (state.hrTab === 'types') await renderLeaveTypes(target);
  if (state.hrTab === 'balances') await renderHrBalances(target);
  if (state.hrTab === 'holidays') await renderHolidays(target);
  if (state.hrTab === 'all-requests') await renderAllRequests(target);
}

async function renderEmployees(target, adminMode = false) {
  const [{ items }, departments] = await Promise.all([api('/api/hr/users'), api('/api/departments')]);
  state.hrUsers = items;
  state.departments = departments.items;
  target.innerHTML = `
    <div class="toolbar">
      <div class="search"><input id="employee-search" class="input" placeholder="Tìm tên, mã nhân viên, email..."></div>
      <button id="export-employees" class="btn btn-outline">⇩ Xuất CSV</button>
      <button id="add-employee" class="btn btn-primary filters-end">＋ Thêm nhân viên</button>
    </div>
    <section id="employee-table" class="card"></section>`;
  const draw = () => {
    const query = $('#employee-search').value.toLowerCase().trim();
    const filtered = state.hrUsers.filter((item) => `${item.employeeCode} ${item.fullName} ${item.email} ${item.username}`.toLowerCase().includes(query));
    $('#employee-table').innerHTML = table(
      ['Mã NV', 'Họ tên', 'Tài khoản', 'Phòng ban', 'Vai trò', 'Trạng thái', ''],
      filtered.map((item) => [
        `<strong>${esc(item.employeeCode)}</strong>`,
        `<div class="cell-user"><span class="avatar">${esc(item.avatar)}</span><div><strong>${esc(item.fullName)}</strong><small>${esc(item.email)}</small></div></div>`,
        esc(item.username),
        esc(item.department || '—'),
        roleBadge(item.role),
        activeBadge(item.active),
        `<button class="btn btn-outline btn-small edit-employee" data-id="${item.id}">Chỉnh sửa</button>`
      ])
    );
    $$('.edit-employee', $('#employee-table')).forEach((button) => button.addEventListener('click', () => openEmployeeForm(state.hrUsers.find((item) => item.id === Number(button.dataset.id)), adminMode)));
  };
  draw();
  $('#employee-search').addEventListener('input', draw);
  $('#export-employees').addEventListener('click', () => downloadFile('/api/export/users'));
  $('#add-employee').addEventListener('click', () => openEmployeeForm(null, adminMode));
}

function openEmployeeForm(item = null, adminMode = false) {
  const isEdit = Boolean(item);
  const roles = Object.entries(ROLE_LABELS).filter(([role]) => adminMode || role !== 'admin');
  openModal({
    title: isEdit ? `Cập nhật ${item.fullName}` : 'Thêm nhân viên',
    subtitle: isEdit ? 'Có thể đổi thông tin, vai trò, trạng thái hoặc đặt lại mật khẩu.' : 'Mật khẩu mặc định là 123456 nếu để trống.',
    body: `<form class="form-grid">
      <div class="form-group"><label class="field-label">Mã nhân viên</label><input id="employee-code" class="input" value="${esc(item?.employeeCode || '')}" ${isEdit ? 'disabled' : ''}></div>
      <div class="form-group"><label class="field-label">Tên đăng nhập</label><input id="employee-username" class="input" value="${esc(item?.username || '')}" ${isEdit ? 'disabled' : ''}></div>
      <div class="form-group full"><label class="field-label">Họ và tên</label><input id="employee-name" class="input" value="${esc(item?.fullName || '')}"></div>
      <div class="form-group"><label class="field-label">Email</label><input id="employee-email" class="input" type="email" value="${esc(item?.email || '')}"></div>
      <div class="form-group"><label class="field-label">Điện thoại</label><input id="employee-phone" class="input" value="${esc(item?.phone || '')}"></div>
      <div class="form-group"><label class="field-label">Phòng ban</label><select id="employee-department" class="input">
        ${state.departments.map((department) => `<option value="${department.id}" ${department.id === item?.departmentId ? 'selected' : ''}>${esc(department.name)}</option>`).join('')}
      </select></div>
      <div class="form-group"><label class="field-label">Vai trò</label><select id="employee-role" class="input">
        ${roles.map(([role, label]) => `<option value="${role}" ${role === item?.role ? 'selected' : ''}>${esc(label)}</option>`).join('')}
      </select></div>
      <div class="form-group"><label class="field-label">Ngày vào làm</label><input id="employee-start" class="input" type="date" value="${esc(item?.startDate || new Date().toISOString().slice(0, 10))}"></div>
      <div class="form-group"><label class="field-label">${isEdit ? 'Mật khẩu mới (nếu đổi)' : 'Mật khẩu ban đầu'}</label><input id="employee-password" class="input" type="password" placeholder="${isEdit ? 'Để trống nếu không đổi' : '123456'}"></div>
      ${isEdit ? `<div class="form-group full"><label class="check-row"><input id="employee-active" type="checkbox" ${item.active ? 'checked' : ''}> Tài khoản đang hoạt động</label></div>` : ''}
    </form>`,
    footer: `<button class="btn btn-outline" data-close-modal>Hủy</button><button id="save-employee" class="btn btn-primary">${isEdit ? 'Lưu thay đổi' : 'Tạo nhân viên'}</button>`
  });
  $('[data-close-modal]').addEventListener('click', closeModal);
  $('#save-employee').addEventListener('click', async () => {
    const body = {
      employeeCode: $('#employee-code').value.trim(),
      username: $('#employee-username').value.trim(),
      fullName: $('#employee-name').value.trim(),
      email: $('#employee-email').value.trim(),
      phone: $('#employee-phone').value.trim(),
      departmentId: Number($('#employee-department').value),
      role: $('#employee-role').value,
      startDate: $('#employee-start').value,
      password: $('#employee-password').value || (isEdit ? undefined : '123456'),
      active: isEdit ? $('#employee-active').checked : true
    };
    try {
      await api(isEdit ? `/api/hr/users/${item.id}` : '/api/hr/users', { method: isEdit ? 'PUT' : 'POST', body });
      closeModal();
      toast(isEdit ? 'Đã cập nhật nhân viên.' : 'Đã tạo nhân viên.');
      await navigate(state.page, false);
    } catch (error) {
      toast(error.message, true);
    }
  });
}

async function renderLeaveTypes(target) {
  const { items } = await api('/api/hr/leave-types');
  state.hrLeaveTypes = items;
  target.innerHTML = `
    <div class="toolbar"><button id="add-leave-type" class="btn btn-primary filters-end">＋ Thêm loại phép</button></div>
    <section class="card">${table(
      ['Mã', 'Loại phép', 'Hạn mức năm', 'Tối đa/đơn', 'Minh chứng', 'Hưởng lương', 'Trạng thái', ''],
      items.map((item) => [
        `<strong>${esc(item.code)}</strong>`, esc(item.name), `${item.annualQuota} ngày`, `${item.maxDays || '—'} ngày`,
        item.requiresProof ? 'Bắt buộc' : 'Không', item.paid ? 'Có' : 'Không', activeBadge(item.active),
        `<button class="btn btn-outline btn-small edit-leave-type" data-id="${item.id}">Chỉnh sửa</button>`
      ])
    )}</section>`;
  $('#add-leave-type').addEventListener('click', () => openLeaveTypeForm());
  $$('.edit-leave-type').forEach((button) => button.addEventListener('click', () => openLeaveTypeForm(items.find((item) => item.id === Number(button.dataset.id)))));
}

function openLeaveTypeForm(item = null) {
  const isEdit = Boolean(item);
  openModal({
    title: isEdit ? `Cập nhật ${item.name}` : 'Thêm loại nghỉ phép',
    body: `<div class="form-grid">
      <div class="form-group"><label class="field-label">Mã loại</label><input id="type-code" class="input" value="${esc(item?.code || '')}" ${isEdit ? 'disabled' : ''}></div>
      <div class="form-group"><label class="field-label">Tên loại phép</label><input id="type-name" class="input" value="${esc(item?.name || '')}"></div>
      <div class="form-group"><label class="field-label">Hạn mức năm</label><input id="type-quota" class="input" type="number" min="0" step="0.5" value="${item?.annualQuota ?? 0}"></div>
      <div class="form-group"><label class="field-label">Tối đa mỗi đơn</label><input id="type-max" class="input" type="number" min="0" step="0.5" value="${item?.maxDays ?? 0}"></div>
      <div class="form-group full"><label class="field-label">Mô tả</label><textarea id="type-description" class="input">${esc(item?.description || '')}</textarea></div>
      <div class="form-group"><label class="check-row"><input id="type-proof" type="checkbox" ${item?.requiresProof ? 'checked' : ''}> Yêu cầu minh chứng</label></div>
      <div class="form-group"><label class="check-row"><input id="type-paid" type="checkbox" ${item?.paid !== false ? 'checked' : ''}> Hưởng lương</label></div>
      ${isEdit ? `<div class="form-group full"><label class="check-row"><input id="type-active" type="checkbox" ${item.active ? 'checked' : ''}> Đang áp dụng</label></div>` : ''}
    </div>`,
    footer: `<button class="btn btn-outline" data-close-modal>Hủy</button><button id="save-leave-type" class="btn btn-primary">Lưu</button>`
  });
  $('[data-close-modal]').addEventListener('click', closeModal);
  $('#save-leave-type').addEventListener('click', async () => {
    const body = {
      code: $('#type-code').value.trim(),
      name: $('#type-name').value.trim(),
      annualQuota: Number($('#type-quota').value),
      maxDays: Number($('#type-max').value),
      description: $('#type-description').value.trim(),
      requiresProof: $('#type-proof').checked,
      paid: $('#type-paid').checked,
      active: isEdit ? $('#type-active').checked : true
    };
    try {
      await api(isEdit ? `/api/hr/leave-types/${item.id}` : '/api/hr/leave-types', { method: isEdit ? 'PUT' : 'POST', body });
      closeModal();
      toast('Đã lưu loại nghỉ phép.');
      await navigate('hr', false);
    } catch (error) {
      toast(error.message, true);
    }
  });
}

async function renderHrBalances(target) {
  const year = state.hrBalanceYear || new Date().getFullYear();
  const { items } = await api(`/api/hr/balances?year=${year}`);
  state.hrBalances = items;
  target.innerHTML = `
    <div class="toolbar">
      <select id="hr-balance-year" class="input">
        ${[year - 1, year, year + 1].map((value) => `<option value="${value}" ${value === year ? 'selected' : ''}>Năm ${value}</option>`).join('')}
      </select>
      <button id="export-balances" class="btn btn-outline filters-end">⇩ Xuất CSV</button>
    </div>
    <section class="card">${table(
    ['Mã NV', 'Nhân viên', 'Loại phép', 'Năm', 'Được cấp', 'Điều chỉnh', 'Đã dùng', 'Còn lại', ''],
    items.map((item) => [
      esc(item.employeeCode), esc(item.employeeName), esc(item.leaveType), item.year,
      item.allocated, item.adjustment, item.used, `<strong>${item.remaining}</strong>`,
      `<button class="btn btn-outline btn-small edit-balance" data-id="${item.id}">Điều chỉnh</button>`
    ])
  )}</section>`;
  $('#hr-balance-year').addEventListener('change', async (event) => {
    state.hrBalanceYear = Number(event.target.value);
    await renderHrBalances(target);
  });
  $('#export-balances').addEventListener('click', () => downloadFile(`/api/export/balances?year=${year}`));
  $$('.edit-balance').forEach((button) => button.addEventListener('click', () => {
    const item = items.find((row) => row.id === Number(button.dataset.id));
    openModal({
      title: `Điều chỉnh phép · ${item.employeeName}`,
      subtitle: `${item.leaveType} năm ${item.year} · đã dùng ${item.used} ngày`,
      body: `<div class="form-grid">
        <div class="form-group"><label class="field-label">Số ngày được cấp</label><input id="balance-allocated" class="input" type="number" min="0" step="0.5" value="${item.allocated}"></div>
        <div class="form-group"><label class="field-label">Điều chỉnh cộng/trừ</label><input id="balance-adjustment" class="input" type="number" step="0.5" value="${item.adjustment}"></div>
      </div>`,
      footer: '<button class="btn btn-outline" data-close-modal>Hủy</button><button id="save-balance" class="btn btn-primary">Lưu</button>'
    });
    $('[data-close-modal]').addEventListener('click', closeModal);
    $('#save-balance').addEventListener('click', async () => {
      try {
        await api(`/api/hr/balances/${item.id}`, {
          method: 'PUT',
          body: { allocated: Number($('#balance-allocated').value), adjustment: Number($('#balance-adjustment').value) }
        });
        closeModal();
        toast('Đã điều chỉnh số dư phép.');
        await navigate('hr', false);
      } catch (error) {
        toast(error.message, true);
      }
    });
  }));
}

async function renderHolidays(target) {
  const { items } = await api('/api/holidays');
  target.innerHTML = `
    <div class="toolbar"><button id="add-holiday" class="btn btn-primary filters-end">＋ Thêm ngày lễ</button></div>
    <section class="card">${table(
      ['Tên ngày lễ', 'Từ ngày', 'Đến ngày', 'Số ngày', ''],
      items.map((item) => [
        `<strong>${esc(item.name)}</strong>`, formatDate(item.startDate), formatDate(item.endDate), `${item.days} ngày`,
        `<button class="btn btn-danger btn-small delete-holiday" data-id="${item.id}" data-name="${esc(item.name)}">Xóa</button>`
      ])
    )}</section>`;
  $('#add-holiday').addEventListener('click', () => {
    openModal({
      title: 'Thêm ngày nghỉ lễ',
      body: `<div class="form-grid">
        <div class="form-group full"><label class="field-label">Tên ngày lễ</label><input id="holiday-name" class="input"></div>
        <div class="form-group"><label class="field-label">Từ ngày</label><input id="holiday-start" class="input" type="date"></div>
        <div class="form-group"><label class="field-label">Đến ngày</label><input id="holiday-end" class="input" type="date"></div>
      </div>`,
      footer: '<button class="btn btn-outline" data-close-modal>Hủy</button><button id="save-holiday" class="btn btn-primary">Thêm</button>'
    });
    $('[data-close-modal]').addEventListener('click', closeModal);
    $('#save-holiday').addEventListener('click', async () => {
      try {
        await api('/api/holidays', {
          method: 'POST',
          body: { name: $('#holiday-name').value.trim(), startDate: $('#holiday-start').value, endDate: $('#holiday-end').value }
        });
        closeModal();
        toast('Đã thêm ngày nghỉ lễ.');
        await navigate('hr', false);
      } catch (error) {
        toast(error.message, true);
      }
    });
  });
  $$('.delete-holiday').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm(`Xóa ngày lễ “${button.dataset.name}”?`)) return;
    try {
      await api(`/api/holidays/${button.dataset.id}`, { method: 'DELETE' });
      toast('Đã xóa ngày nghỉ lễ.');
      await navigate('hr', false);
    } catch (error) {
      toast(error.message, true);
    }
  }));
}

async function renderAllRequests(target) {
  const [{ items }, departmentData] = await Promise.all([
    api('/api/requests?scope=all'),
    api('/api/departments')
  ]);
  const departments = departmentData.items;
  state.hrAllRequests = items;
  target.innerHTML = `
    <div class="toolbar">
      <div class="search"><input id="all-request-search" class="input" placeholder="Tìm mã đơn, nhân viên, loại phép..."></div>
      <select id="all-request-status" class="input">
        <option value="">Tất cả trạng thái</option>
        <option value="pending_leader">Chờ trưởng nhóm</option>
        <option value="pending_manager">Chờ trưởng phòng</option>
        <option value="pending_hr">Chờ HR</option>
        <option value="approved">Đã duyệt</option>
        <option value="rejected">Đã từ chối</option>
        <option value="cancelled">Đã hủy</option>
      </select>
      <select id="all-request-department" class="input">
        <option value="">Tất cả phòng ban</option>
        ${departments.map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join('')}
      </select>
      <input id="all-request-from" class="input compact" type="date" title="Từ ngày">
      <input id="all-request-to" class="input compact" type="date" title="Đến ngày">
      <button id="export-all-requests" class="btn btn-outline">⇩ Xuất CSV</button>
    </div>
    <section id="all-requests-table" class="card"></section>`;
  const draw = () => {
    const keyword = $('#all-request-search').value.trim().toLowerCase();
    const status = $('#all-request-status').value;
    const departmentId = Number($('#all-request-department').value || 0);
    const from = $('#all-request-from').value;
    const to = $('#all-request-to').value;
    const filtered = state.hrAllRequests.filter((item) => {
      const text = `${item.code} ${item.employeeCode} ${item.employeeName} ${item.leaveType} ${item.department}`.toLowerCase();
      const statusMatch = !status || (status === 'rejected' ? item.status.startsWith('rejected_') : item.status === status);
      const departmentMatch = !departmentId || item.departmentId === departmentId;
      const dateMatch = (!from || item.endDate >= from) && (!to || item.startDate <= to);
      return text.includes(keyword) && statusMatch && departmentMatch && dateMatch;
    });
    $('#all-requests-table').innerHTML = table(
      ['Mã đơn', 'Nhân viên', 'Loại phép', 'Thời gian', 'Số ngày', 'Trạng thái', ''],
      requestRows(filtered)
    );
    bindRequestActions($('#all-requests-table'));
  };
  draw();
  ['all-request-status', 'all-request-department', 'all-request-from', 'all-request-to']
    .forEach((id) => $(`#${id}`).addEventListener('change', draw));
  $('#all-request-search').addEventListener('input', draw);
  $('#export-all-requests').addEventListener('click', () => {
    const params = new URLSearchParams({ scope: 'all' });
    if ($('#all-request-status').value) params.set('status', $('#all-request-status').value);
    if ($('#all-request-department').value) params.set('departmentId', $('#all-request-department').value);
    if ($('#all-request-from').value) params.set('from', $('#all-request-from').value);
    if ($('#all-request-to').value) params.set('to', $('#all-request-to').value);
    downloadFile(`/api/export/requests?${params}`);
  });
}

