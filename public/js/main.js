async function loadNotifications() {
  if (!state.user) return;
  try {
    const data = await api('/api/notifications');
    state.notifications = data.items;
    $('#notification-count').textContent = data.unread;
    $('#notification-count').hidden = !data.unread;
    $('#notification-subtitle').textContent = data.unread ? `${data.unread} thông báo chưa đọc` : 'Bạn đã xem tất cả thông báo';
    $('#notification-list').innerHTML = data.items.length ? data.items.map((item) => `
      <article class="notification-item ${item.isRead ? '' : 'unread'}" data-id="${item.id}" data-link="${esc(item.link)}">
        <button class="notification-delete" type="button" data-id="${item.id}" aria-label="Xóa thông báo">×</button>
        <h4>${esc(item.title)}</h4>
        <p>${esc(item.body)}</p>
        <time>${formatDateTime(item.createdAt)}</time>
      </article>
    `).join('') : emptyState('Chưa có thông báo');
    $$('.notification-delete').forEach((button) => button.addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        await api(`/api/notifications/${button.dataset.id}`, { method: 'DELETE' });
        await loadNotifications();
      } catch (error) {
        toast(error.message, true);
      }
    }));
    $$('.notification-item').forEach((item) => item.addEventListener('click', async () => {
      try {
        await api(`/api/notifications/${item.dataset.id}/read`, { method: 'POST' });
        loadNotifications();
      } catch {
        // Reading a notification should not block navigation.
      }
      $('#notification-panel').classList.remove('open');
      const link = item.dataset.link;
      if (link === 'approvals' && ['leader', 'manager', 'hr'].includes(state.user.role)) navigate('approvals');
      if (link === 'requests' && state.user.role !== 'admin') navigate('requests');
    }));
  } catch {
    // Notifications do not block the main workflow.
  }
}

async function initialize() {
  try {
    const { user } = await api('/api/auth/me');
    showApp(user);
  } catch {
    showLogin();
  }
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('button[type="submit"]', event.target);
  const error = $('#login-error');
  error.hidden = true;
  button.disabled = true;
  try {
    const { user } = await api('/api/auth/login', {
      method: 'POST',
      body: { username: $('#login-user').value.trim(), password: $('#login-pass').value }
    });
    showApp(user);
  } catch (loginError) {
    error.textContent = loginError.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

$('.password-toggle').addEventListener('click', () => {
  const input = $('#login-pass');
  input.type = input.type === 'password' ? 'text' : 'password';
});

$$('.demo-accounts button').forEach((button) => button.addEventListener('click', () => {
  $('#login-user').value = button.dataset.account;
  $('#login-pass').value = '123456';
}));

$$('.theme-toggle').forEach((button) => button.addEventListener('click', toggleTheme));
updateThemeButtons(document.documentElement.dataset.theme || getStoredTheme());

$('#logout-button').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    showLogin();
  }
});

$('#open-sidebar').addEventListener('click', () => {
  $('#sidebar').classList.add('open');
  $('#sidebar-overlay').classList.add('open');
});
$('#close-sidebar').addEventListener('click', closeSidebar);
$('#sidebar-overlay').addEventListener('click', closeSidebar);

$('#notification-button').addEventListener('click', () => {
  $('#notification-panel').classList.toggle('open');
  if ($('#notification-panel').classList.contains('open')) loadNotifications();
});
$('#close-notifications').addEventListener('click', () => $('#notification-panel').classList.remove('open'));
$('#read-all-notifications').addEventListener('click', async () => {
  try {
    await api('/api/notifications/read-all', { method: 'POST' });
    await loadNotifications();
  } catch (error) {
    toast(error.message, true);
  }
});
$('#delete-read-notifications').addEventListener('click', async () => {
  try {
    await api('/api/notifications/read', { method: 'DELETE' });
    await loadNotifications();
    toast('Đã xóa các thông báo đã đọc.');
  } catch (error) {
    toast(error.message, true);
  }
});

$('#profile-shortcut').addEventListener('click', () => navigate('profile'));
$('#modal-close').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (event) => {
  if (event.target === $('#modal')) closeModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeModal();
    closeSidebar();
    $('#notification-panel').classList.remove('open');
  }
});
window.addEventListener('hashchange', () => {
  if (!state.user) return;
  const page = location.hash.replace('#/', '');
  if (page && page !== state.page) navigate(page, false);
});

initialize();
