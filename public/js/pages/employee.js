async function renderDashboard() {
  const { stats, monthly, byType, recent } = await api('/api/dashboard');
  const now = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  $('#page-content').innerHTML = `
    ${pageHeading(`Xin chào, ${state.user.fullName}!`, `Hôm nay là ${now}`)}
    <div class="stats-grid">
      ${statCard(stats.total, state.user.role === 'employee' ? 'Tổng đơn của tôi' : 'Tổng đơn hệ thống', '▤', 'blue')}
      ${statCard(stats.pending, 'Đơn chờ xử lý', '◷', 'yellow')}
      ${statCard(stats.approved, 'Đơn đã duyệt', '✓', 'green')}
      ${statCard(stats.fourth, stats.fourthLabel, '◫', 'purple')}
    </div>
    <div class="grid two">
      <section class="card">
        <div class="card-header"><div><h3>Ngày nghỉ đã duyệt theo tháng</h3><p>Năm ${new Date().getFullYear()}</p></div></div>
        <div class="card-body">${monthlyChart(monthly)}</div>
      </section>
      <section class="card">
        <div class="card-header"><div><h3>Phân loại đơn</h3><p>Tỷ trọng theo loại nghỉ</p></div></div>
        <div class="card-body">${donutChart(byType)}</div>
      </section>
    </div>
    <section class="card">
      <div class="card-header">
        <div><h3>Đơn gần đây</h3><p>Các yêu cầu mới nhất</p></div>
        ${state.user.role !== 'admin' ? '<button id="dashboard-view-all" class="btn btn-outline btn-small">Xem tất cả</button>' : ''}
      </div>
      ${table(['Mã đơn', 'Nhân viên', 'Loại phép', 'Thời gian', 'Số ngày', 'Trạng thái', ''], requestRows(recent))}
    </section>`;
  bindRequestActions($('#page-content'));
  $('#dashboard-view-all')?.addEventListener('click', () => navigate('requests'));
}

async function renderRequests() {
  const [{ items }, typeData] = await Promise.all([api('/api/requests?scope=my'), api('/api/leave-types')]);
  state.requests = items;
  state.leaveTypes = typeData.items;
  $('#page-content').innerHTML = `
    ${pageHeading('Đơn nghỉ phép của tôi', 'Tạo mới, theo dõi tiến độ và xem lịch sử phê duyệt',
      '<button id="export-my-requests" class="btn btn-outline">⇩ Xuất CSV</button><button id="new-request" class="btn btn-primary">＋ Tạo đơn mới</button>')}
    <div class="toolbar">
      <div class="search"><input id="request-search" class="input" placeholder="Tìm mã đơn, loại phép..."></div>
      <select id="request-status" class="input">
        <option value="">Tất cả trạng thái</option>
        <option value="pending_leader">Chờ trưởng nhóm</option>
        <option value="pending_manager">Chờ trưởng phòng</option>
        <option value="pending_hr">Chờ HR</option>
        <option value="approved">Đã duyệt</option>
        <option value="rejected">Đã từ chối</option>
        <option value="cancelled">Đã hủy</option>
      </select>
      <input id="request-from" class="input compact" type="date" title="Từ ngày">
      <input id="request-to" class="input compact" type="date" title="Đến ngày">
    </div>
    <section id="requests-table" class="card"></section>`;
  const draw = () => {
    const keyword = $('#request-search').value.trim().toLowerCase();
    const status = $('#request-status').value;
    const from = $('#request-from').value;
    const to = $('#request-to').value;
    const filtered = state.requests.filter((item) => {
      const text = `${item.code} ${item.leaveType} ${item.reason}`.toLowerCase();
      const statusMatch = !status || (status === 'rejected' ? item.status.startsWith('rejected_') : item.status === status);
      const dateMatch = (!from || item.endDate >= from) && (!to || item.startDate <= to);
      return text.includes(keyword) && statusMatch && dateMatch;
    });
    $('#requests-table').innerHTML = table(['Mã đơn', 'Nhân viên', 'Loại phép', 'Thời gian', 'Số ngày', 'Trạng thái', ''], requestRows(filtered));
    bindRequestActions($('#requests-table'));
  };
  draw();
  $('#request-search').addEventListener('input', draw);
  $('#request-status').addEventListener('change', draw);
  $('#request-from').addEventListener('change', draw);
  $('#request-to').addEventListener('change', draw);
  $('#export-my-requests').addEventListener('click', () => {
    const params = new URLSearchParams({ scope: 'my' });
    if ($('#request-status').value) params.set('status', $('#request-status').value);
    if ($('#request-from').value) params.set('from', $('#request-from').value);
    if ($('#request-to').value) params.set('to', $('#request-to').value);
    downloadFile(`/api/export/requests?${params}`);
  });
  $('#new-request').addEventListener('click', openCreateRequest);
}

function openModal({ title, subtitle = '', body, footer = '', wide = false }) {
  $('#modal-title').textContent = title;
  $('#modal-subtitle').textContent = subtitle;
  $('#modal-body').innerHTML = body;
  $('#modal-footer').innerHTML = footer;
  $('.modal', $('#modal')).classList.toggle('modal-wide', wide);
  $('#modal').hidden = false;
}

function closeModal() {
  $('#modal').hidden = true;
  $('#modal-body').innerHTML = '';
  $('#modal-footer').innerHTML = '';
}

function openCreateRequest() {
  const today = new Date().toISOString().slice(0, 10);
  openModal({
    title: 'Tạo đơn nghỉ phép',
    subtitle: 'Số ngày được tính theo ngày làm việc, không gồm cuối tuần và ngày lễ.',
    body: `<form id="request-form" class="form-grid">
      <div class="form-group full">
        <label class="field-label">Loại nghỉ phép</label>
        <select id="new-leave-type" class="input" required>
          <option value="">Chọn loại phép</option>
          ${state.leaveTypes.map((item) => `<option value="${item.id}">${esc(item.name)}${item.annualQuota ? ` · hạn mức ${item.annualQuota} ngày` : ''}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="field-label">Từ ngày</label>
        <input id="new-start" class="input" type="date" min="${today}" required>
      </div>
      <div class="form-group">
        <label class="field-label">Đến ngày</label>
        <input id="new-end" class="input" type="date" min="${today}" required>
      </div>
      <div class="form-group full">
        <div id="request-preview" class="request-preview" hidden></div>
      </div>
      <div class="form-group full">
        <label class="field-label">Lý do nghỉ</label>
        <textarea id="new-reason" class="input" maxlength="1000" placeholder="Mô tả ngắn gọn lý do..." required></textarea>
      </div>
      <div class="form-group full">
        <label class="field-label">Tệp minh chứng</label>
        <input id="new-attachment" class="input" type="file" accept=".pdf,.png,.jpg,.jpeg">
        <span class="form-hint">Bản này lưu tên tệp để phục vụ quy trình demo; có thể nối dịch vụ lưu file khi triển khai thật.</span>
      </div>
    </form>`,
    footer: '<button class="btn btn-outline" data-close-modal>Hủy</button><button id="submit-request" class="btn btn-primary">Gửi đơn</button>'
  });
  $('[data-close-modal]').addEventListener('click', closeModal);
  let previewTimer;
  const renderPreview = async () => {
    const preview = $('#request-preview');
    const leaveTypeId = Number($('#new-leave-type').value);
    const startDate = $('#new-start').value;
    const endDate = $('#new-end').value;
    if (!leaveTypeId || !startDate || !endDate) {
      preview.hidden = true;
      $('#submit-request').disabled = false;
      return;
    }
    preview.hidden = false;
    preview.className = 'request-preview loading';
    preview.innerHTML = '<span class="spinner spinner-small"></span> Đang kiểm tra đơn nghỉ...';
    try {
      const data = await api('/api/requests/preview', {
        method: 'POST',
        body: {
          leaveTypeId,
          startDate,
          endDate,
          attachmentName: $('#new-attachment').files[0]?.name || ''
        }
      });
      preview.className = `request-preview ${data.blocked ? 'danger' : 'success'}`;
      $('#submit-request').disabled = Boolean(data.blocked);
      const balance = data.balance;
      const warnings = data.warnings.map((item) => `
        <li class="${item.level}">${esc(item.message)}</li>
      `).join('');
      const conflicts = data.conflicts.length ? `
        <div class="preview-conflicts">
          <strong>Lịch nghỉ trùng trong phòng ban</strong>
          ${data.conflicts.map((item) => `
            <div class="preview-conflict-item">
              <span>${esc(item.employeeName)}</span>
              <small>${formatDate(item.startDate)} – ${formatDate(item.endDate)} · ${esc(item.leaveType)}</small>
            </div>
          `).join('')}
        </div>` : '';
      preview.innerHTML = `
        <div class="preview-grid">
          <div><span>Số ngày làm việc</span><strong>${data.days}</strong></div>
          <div><span>Phép khả dụng</span><strong>${balance ? balance.available : 'Không giới hạn'}</strong></div>
          <div><span>Còn lại sau đơn</span><strong>${balance ? balance.remainingAfter : '—'}</strong></div>
        </div>
        ${warnings ? `<ul class="preview-warnings">${warnings}</ul>` : '<p class="preview-ok">Đơn hợp lệ, có thể gửi phê duyệt.</p>'}
        ${conflicts}`;
    } catch (error) {
      preview.className = 'request-preview danger';
      preview.innerHTML = `<p>${esc(error.message)}</p>`;
      $('#submit-request').disabled = true;
    }
  };
  const schedulePreview = () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 250);
  };
  $('#new-start').addEventListener('change', () => {
    $('#new-end').min = $('#new-start').value || today;
    if ($('#new-end').value && $('#new-end').value < $('#new-start').value) $('#new-end').value = $('#new-start').value;
    schedulePreview();
  });
  $('#new-leave-type').addEventListener('change', schedulePreview);
  $('#new-end').addEventListener('change', schedulePreview);
  $('#new-attachment').addEventListener('change', schedulePreview);
  $('#submit-request').addEventListener('click', async () => {
    const button = $('#submit-request');
    const body = {
      leaveTypeId: Number($('#new-leave-type').value),
      startDate: $('#new-start').value,
      endDate: $('#new-end').value,
      reason: $('#new-reason').value.trim(),
      attachmentName: $('#new-attachment').files[0]?.name || ''
    };
    button.disabled = true;
    try {
      const data = await api('/api/requests', { method: 'POST', body });
      closeModal();
      toast(`Đã gửi đơn ${data.item.code} thành công.`);
      await navigate('requests', false);
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

async function showRequestDetail(id) {
  try {
    const { item } = await api(`/api/requests/${id}`);
    const timeline = item.approvals.map((approval) => {
      const actionText = {
        waiting: 'Chưa đến lượt xử lý',
        pending: 'Đang chờ xử lý',
        approved: `Đã duyệt bởi ${approval.approverName}`,
        rejected: `Đã từ chối bởi ${approval.approverName}`
      }[approval.action];
      return `<div class="timeline-item">
        <span class="timeline-dot ${approval.action}"></span>
        <div class="timeline-title">${esc(approval.roleLabel)}</div>
        <div class="timeline-meta">${esc(actionText)}${approval.actedAt ? ` · ${formatDateTime(approval.actedAt)}` : ''}</div>
        ${approval.note ? `<div class="timeline-note">“${esc(approval.note)}”</div>` : ''}
      </div>`;
    }).join('');
    const expected = { leader: 'pending_leader', manager: 'pending_manager', hr: 'pending_hr' }[state.user.role];
    const canApprove = expected === item.status && item.userId !== state.user.id;
    const canCancel = item.userId === state.user.id && item.status.startsWith('pending_');
    openModal({
      title: `Chi tiết đơn ${item.code}`,
      subtitle: `Tạo lúc ${formatDateTime(item.createdAt)}`,
      wide: true,
      body: `<div class="detail-summary">
        <div><span class="detail-label">Nhân viên</span><strong>${esc(item.employeeName)}</strong><br><small>${esc(item.department)}</small></div>
        <div><span class="detail-label">Loại phép</span><strong>${esc(item.leaveType)}</strong><br><small>${item.days} ngày làm việc</small></div>
        <div><span class="detail-label">Trạng thái</span>${statusBadge(item)}</div>
      </div>
      <table class="detail-table">
        <tr><td>Thời gian nghỉ</td><td><strong>${formatDate(item.startDate)} – ${formatDate(item.endDate)}</strong></td></tr>
        <tr><td>Lý do</td><td>${esc(item.reason)}</td></tr>
        <tr><td>Minh chứng</td><td>${item.attachmentName ? esc(item.attachmentName) : 'Không có'}</td></tr>
        <tr><td>Cập nhật cuối</td><td>${formatDateTime(item.updatedAt)}</td></tr>
      </table>
      <strong>Lịch sử phê duyệt</strong>
      <div class="timeline">${timeline}</div>`,
      footer: `<button class="btn btn-outline" data-close-modal>Đóng</button>
        ${canCancel ? '<button id="cancel-request" class="btn btn-danger">Hủy đơn</button>' : ''}
        ${canApprove ? `<button class="btn btn-danger request-decision" data-id="${item.id}" data-action="reject">Từ chối</button>
          <button class="btn btn-success request-decision" data-id="${item.id}" data-action="approve">Phê duyệt</button>` : ''}`
    });
    $('[data-close-modal]').addEventListener('click', closeModal);
    $('#cancel-request')?.addEventListener('click', async () => {
      if (!confirm(`Hủy đơn ${item.code}?`)) return;
      try {
        await api(`/api/requests/${item.id}/cancel`, { method: 'POST' });
        closeModal();
        toast(`Đã hủy đơn ${item.code}.`);
        await navigate(state.page, false);
      } catch (error) {
        toast(error.message, true);
      }
    });
    $$('.request-decision', $('#modal-footer')).forEach((button) => button.addEventListener('click', () => openDecision(button.dataset.id, button.dataset.action)));
  } catch (error) {
    toast(error.message, true);
  }
}

function openDecision(id, action) {
  openModal({
    title: action === 'approve' ? 'Phê duyệt đơn' : 'Từ chối đơn',
    subtitle: action === 'approve' ? 'Xác nhận chuyển đơn sang bước tiếp theo.' : 'Lý do từ chối sẽ được gửi tới nhân viên.',
    body: `<label class="field-label">${action === 'approve' ? 'Nhận xét (không bắt buộc)' : 'Lý do từ chối'}</label>
      <textarea id="decision-note" class="input" placeholder="${action === 'approve' ? 'Nhập nhận xét...' : 'Nhập lý do cụ thể...'}"></textarea>`,
    footer: `<button class="btn btn-outline" data-close-modal>Hủy</button>
      <button id="submit-decision" class="btn ${action === 'approve' ? 'btn-success' : 'btn-danger'}">${action === 'approve' ? 'Xác nhận duyệt' : 'Xác nhận từ chối'}</button>`
  });
  $('[data-close-modal]').addEventListener('click', closeModal);
  $('#submit-decision').addEventListener('click', async () => {
    const note = $('#decision-note').value.trim();
    if (action === 'reject' && !note) return toast('Vui lòng nhập lý do từ chối.', true);
    $('#submit-decision').disabled = true;
    try {
      await api(`/api/requests/${id}/decision`, { method: 'POST', body: { action, note } });
      closeModal();
      toast(action === 'approve' ? 'Đã phê duyệt đơn.' : 'Đã từ chối đơn.');
      await navigate(state.page, false);
      updateApprovalBadge();
      loadNotifications();
    } catch (error) {
      toast(error.message, true);
      $('#submit-decision').disabled = false;
    }
  });
}

async function renderBalance() {
  const selectedYear = state.balanceYear || new Date().getFullYear();
  const { year, items, history } = await api(`/api/balances/me?year=${selectedYear}`);
  state.balanceYear = year;
  const years = [year - 1, year, year + 1];
  $('#page-content').innerHTML = `
    ${pageHeading('Số ngày phép của tôi', `Hạn mức phép năm ${year}`,
      `<select id="balance-year" class="input compact">${years.map((item) => `<option ${item === year ? 'selected' : ''}>${item}</option>`).join('')}</select>`)}
    ${items.length ? `<div class="balance-grid">${items.map((item) => {
      const total = item.allocated + item.adjustment;
      const percent = total ? Math.min(100, Math.round(item.used / total * 100)) : 0;
      return `<div class="balance-card">
        <div class="balance-card-top"><div><h3>${esc(item.leaveType)}</h3><span class="form-hint">Năm ${item.year}</span></div><div class="balance-number">${item.remaining}</div></div>
        <div class="balance-meta"><span>Đã dùng ${item.used}/${total} ngày</span><span>${percent}%</span></div>
        <div class="progress"><span style="width:${percent}%"></span></div>
      </div>`;
    }).join('')}</div>` : '<div class="alert alert-info">Chưa có hạn mức phép được thiết lập cho năm nay.</div>'}
    <section class="card">
      <div class="card-header"><div><h3>Lịch sử sử dụng phép</h3><p>Các đơn đã được duyệt hoàn tất</p></div></div>
      ${table(['Mã đơn', 'Nhân viên', 'Loại phép', 'Thời gian', 'Số ngày', 'Trạng thái', ''], requestRows(history))}
    </section>`;
  $('#balance-year').addEventListener('change', (event) => {
    state.balanceYear = Number(event.target.value);
    renderBalance();
  });
  bindRequestActions($('#page-content'));
}

async function renderApprovals() {
  const { items } = await api('/api/approvals');
  $('#page-content').innerHTML = `
    ${pageHeading('Đơn chờ phê duyệt', `${items.length} đơn đang chờ bạn xử lý`,
      '<button id="export-team-requests" class="btn btn-outline">⇩ Xuất CSV</button>')}
    ${items.length ? `<div class="alert alert-info">Bạn chỉ thấy các đơn đúng cấp duyệt và thuộc phạm vi phòng ban của mình.</div>` : ''}
    <section class="card">
      ${table(['Mã đơn', 'Nhân viên', 'Loại phép', 'Thời gian', 'Số ngày', 'Trạng thái', 'Hành động'], requestRows(items, 'approve'))}
    </section>`;
  $('#export-team-requests').addEventListener('click', () => {
    const pendingStatus = { leader: 'pending_leader', manager: 'pending_manager', hr: 'pending_hr' }[state.user.role];
    const scope = state.user.role === 'hr' ? 'all' : 'team';
    downloadFile(`/api/export/requests?scope=${scope}&status=${pendingStatus}`);
  });
  bindRequestActions($('#page-content'));
}

async function renderCalendar(month = new Date().toISOString().slice(0, 7)) {
  const { items } = await api(`/api/calendar?month=${month}`);
  const [year, monthNumber] = month.split('-').map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const grouped = new Map();
  items.forEach((item) => {
    if (!grouped.has(item.userId)) grouped.set(item.userId, { name: item.employeeName, department: item.department, dates: new Set(), types: new Set() });
    const group = grouped.get(item.userId);
    let cursor = new Date(`${item.startDate}T00:00:00Z`);
    const end = new Date(`${item.endDate}T00:00:00Z`);
    while (cursor <= end) {
      if (cursor.getUTCFullYear() === year && cursor.getUTCMonth() + 1 === monthNumber) group.dates.add(cursor.getUTCDate());
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    group.types.add(item.leaveType);
  });
  const headerDays = Array.from({ length: days }, (_, index) => index + 1);
  const rows = [...grouped.values()].map((person) => `<tr>
    <td>${esc(person.name)}<br><small>${esc(person.department)}</small></td>
    ${headerDays.map((day) => {
      const weekDay = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
      return `<td title="${person.dates.has(day) ? esc([...person.types].join(', ')) : ''}"><div class="calendar-day ${person.dates.has(day) ? 'leave' : ''} ${weekDay === 0 || weekDay === 6 ? 'weekend' : ''}"></div></td>`;
    }).join('')}
  </tr>`).join('');
  $('#page-content').innerHTML = `
    ${pageHeading('Lịch nghỉ nhân sự', 'Các đơn đã được phê duyệt hoàn tất',
      `<input id="calendar-month" class="input compact" type="month" value="${month}">`)}
    <section class="card">
      <div class="card-header"><div><h3>Tháng ${monthNumber}/${year}</h3><p>${items.length} lượt nghỉ đã duyệt</p></div><span class="badge badge-info">Màu xanh: ngày nghỉ</span></div>
      ${grouped.size ? `<div class="calendar-wrap"><table class="calendar-table">
        <thead><tr><th>Nhân viên</th>${headerDays.map((day) => `<th>${day}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : emptyState('Tháng này chưa có lịch nghỉ đã duyệt')}
    </section>`;
  $('#calendar-month').addEventListener('change', (event) => renderCalendar(event.target.value));
}

