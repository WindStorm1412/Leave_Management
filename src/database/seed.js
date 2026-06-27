async function seed(db, hashPassword) {
  const count = Number((await db.prepare('SELECT COUNT(*) AS count FROM users').get()).count);
  if (count > 0) return;

  const insertDepartment = db.prepare(
    'INSERT INTO departments (code, name) VALUES (?, ?)'
  );
  for (const row of [
    ['D01', 'Kỹ thuật'],
    ['D02', 'Kinh doanh'],
    ['D03', 'Marketing'],
    ['D04', 'Nhân sự'],
    ['D05', 'Công nghệ thông tin']
  ]) {
    await insertDepartment.run(...row);
  }

  const departmentRows = await db.prepare('SELECT id, name FROM departments').all();
  const departments = Object.fromEntries(
    departmentRows.map((item) => [item.name, item.id])
  );
  const password = hashPassword('123456');
  const insertUser = db.prepare(`
    INSERT INTO users
      (employee_code, username, password_hash, full_name, email, phone,
       role, department_id, start_date, avatar)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const users = [
    ['NV001', 'nhanvien01', password, 'Nguyễn Văn A', 'nva@company.vn', '0901000001', 'employee', departments['Kỹ thuật'], '2022-03-01', 'NA'],
    ['NV002', 'leader01', password, 'Lê Văn C', 'lvc@company.vn', '0901000002', 'leader', departments['Kỹ thuật'], '2020-01-15', 'LC'],
    ['NV003', 'manager01', password, 'Trần Thị B', 'ttb@company.vn', '0901000003', 'manager', departments['Kỹ thuật'], '2019-06-10', 'TB'],
    ['NV004', 'nhanvien02', password, 'Trần Văn D', 'tvd@company.vn', '0901000004', 'employee', departments['Kỹ thuật'], '2023-09-05', 'TD'],
    ['NV005', 'nhanvien03', password, 'Phạm Thị E', 'pte@company.vn', '0901000005', 'employee', departments['Kinh doanh'], '2021-11-20', 'PE'],
    ['NV006', 'nhanvien04', password, 'Lê Thị F', 'ltf@company.vn', '0901000006', 'employee', departments['Marketing'], '2022-07-01', 'LF'],
    ['NV007', 'hr01', password, 'Phạm Thị HR', 'hr@company.vn', '0901000007', 'hr', departments['Nhân sự'], '2018-01-01', 'HR'],
    ['NV008', 'admin', password, 'Admin Hệ thống', 'admin@company.vn', '0901000008', 'admin', departments['Công nghệ thông tin'], '2018-01-01', 'AD'],
    ['NV009', 'leader02', password, 'Nguyễn Minh Khang', 'nmk@company.vn', '0901000009', 'leader', departments['Kinh doanh'], '2020-04-10', 'NK'],
    ['NV010', 'manager02', password, 'Vũ Thu Hà', 'vth@company.vn', '0901000010', 'manager', departments['Kinh doanh'], '2019-02-12', 'VH'],
    ['NV011', 'leader03', password, 'Đặng Hoàng Nam', 'dhn@company.vn', '0901000011', 'leader', departments['Marketing'], '2021-05-20', 'DN'],
    ['NV012', 'manager03', password, 'Bùi Ngọc Mai', 'bnm@company.vn', '0901000012', 'manager', departments['Marketing'], '2019-08-08', 'BM']
  ];
  for (const row of users) {
    await insertUser.run(...row);
  }
  await db.exec(`
    UPDATE departments d
    SET d.leader_id = (
      SELECT MIN(u.id) FROM users u
      WHERE u.department_id = d.id AND u.role = 'leader' AND u.active = 1
    ),
    d.manager_id = (
      SELECT MIN(u.id) FROM users u
      WHERE u.department_id = d.id AND u.role = 'manager' AND u.active = 1
    )
  `);

  const insertType = db.prepare(`
    INSERT INTO leave_types
      (code, name, annual_quota, max_days, requires_proof, paid, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of [
    ['LT01', 'Nghỉ phép năm', 12, 12, 0, 1, 'Phép năm hưởng nguyên lương theo chính sách công ty'],
    ['LT02', 'Nghỉ bệnh', 30, 30, 1, 1, 'Cần giấy xác nhận y tế khi nghỉ từ 2 ngày'],
    ['LT03', 'Nghỉ không lương', 0, 30, 0, 0, 'Nghỉ không hưởng lương theo thỏa thuận'],
    ['LT04', 'Nghỉ thai sản', 180, 180, 1, 1, 'Áp dụng theo quy định pháp luật hiện hành'],
    ['LT05', 'Nghỉ việc riêng', 3, 3, 0, 1, 'Kết hôn, tang lễ và các trường hợp việc riêng']
  ]) {
    await insertType.run(...row);
  }

  const year = new Date().getFullYear();
  const annualType = await db.prepare(
    "SELECT id FROM leave_types WHERE code = 'LT01'"
  ).get();
  const employeeRows = await db.prepare(
    "SELECT id FROM users WHERE role != 'admin'"
  ).all();
  const insertBalance = db.prepare(`
    INSERT INTO leave_balances
      (user_id, leave_type_id, year, allocated, used, adjustment)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const [index, user] of employeeRows.entries()) {
    await insertBalance.run(
      user.id,
      annualType.id,
      year,
      12,
      index % 3,
      index === 1 ? 1 : 0
    );
  }

  const insertHoliday = db.prepare(
    'INSERT INTO holidays (name, start_date, end_date) VALUES (?, ?, ?)'
  );
  for (const row of [
    ['Tết Dương lịch', `${year}-01-01`, `${year}-01-01`],
    ['Tết Nguyên Đán', `${year}-02-16`, `${year}-02-20`],
    ['Giỗ Tổ Hùng Vương', `${year}-04-26`, `${year}-04-26`],
    ['Ngày Giải phóng & Quốc tế Lao động', `${year}-04-30`, `${year}-05-01`],
    ['Quốc khánh', `${year}-09-02`, `${year}-09-03`]
  ]) {
    await insertHoliday.run(...row);
  }

  const userRows = await db.prepare('SELECT id, full_name FROM users').all();
  const userByName = Object.fromEntries(
    userRows.map((item) => [item.full_name, item.id])
  );
  const typeRows = await db.prepare('SELECT id, name FROM leave_types').all();
  const typeByName = Object.fromEntries(
    typeRows.map((item) => [item.name, item.id])
  );
  const insertRequest = db.prepare(`
    INSERT INTO leave_requests
      (request_code, user_id, leave_type_id, start_date, end_date, days,
       reason, status, current_step, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const sampleRequests = [
    ['LR0001', 'Nguyễn Văn A', 'Nghỉ phép năm', `${year}-01-12`, `${year}-01-13`, 2, 'Du lịch cùng gia đình', 'approved', 3, `${year}-01-05 08:30:00`],
    ['LR0002', 'Nguyễn Văn A', 'Nghỉ bệnh', `${year}-06-25`, `${year}-06-26`, 2, 'Khám và điều trị theo chỉ định bác sĩ', 'pending_manager', 2, `${year}-06-18 09:15:00`],
    ['LR0003', 'Trần Văn D', 'Nghỉ phép năm', `${year}-06-29`, `${year}-06-29`, 1, 'Giải quyết việc gia đình', 'pending_leader', 1, `${year}-06-20 10:00:00`],
    ['LR0004', 'Phạm Thị E', 'Nghỉ không lương', `${year}-07-06`, `${year}-07-08`, 3, 'Việc gia đình khẩn cấp', 'pending_manager', 2, `${year}-06-19 14:20:00`],
    ['LR0005', 'Lê Thị F', 'Nghỉ bệnh', `${year}-06-23`, `${year}-06-23`, 1, 'Không đảm bảo sức khỏe', 'rejected_by_leader', 1, `${year}-06-17 08:10:00`],
    ['LR0006', 'Nguyễn Văn A', 'Nghỉ phép năm', `${year}-07-20`, `${year}-07-21`, 2, 'Nghỉ ngắn ngày', 'pending_hr', 3, `${year}-06-15 11:30:00`]
  ];

  for (const item of sampleRequests) {
    const [code, userName, typeName, start, end, days, reason, status, step, created] = item;
    const result = await insertRequest.run(
      code,
      userByName[userName],
      typeByName[typeName],
      start,
      end,
      days,
      reason,
      status,
      step,
      created
    );
    const requestId = Number(result.lastInsertRowid);
    const departmentApprovers = await db.prepare(`
      SELECT d.leader_id, d.manager_id
      FROM users u JOIN departments d ON d.id = u.department_id
      WHERE u.id = ?
    `).get(userByName[userName]);
    const actions = status === 'approved'
      ? ['approved', 'approved', 'approved']
      : status === 'pending_manager'
        ? ['approved', 'pending', 'waiting']
        : status === 'pending_hr'
          ? ['approved', 'approved', 'pending']
          : status === 'rejected_by_leader'
            ? ['rejected', 'waiting', 'waiting']
            : ['pending', 'waiting', 'waiting'];

    for (const [index, role] of ['leader', 'manager', 'hr'].entries()) {
      const done = ['approved', 'rejected'].includes(actions[index]);
      const approverId = role === 'leader'
        ? departmentApprovers.leader_id
        : role === 'manager'
          ? departmentApprovers.manager_id
          : userByName['Phạm Thị HR'];
      await db.prepare(`
        INSERT INTO approvals
          (request_id, step, approver_role, approver_id, action, note, acted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        requestId,
        index + 1,
        role,
        ['leader', 'manager'].includes(role) || done ? approverId : null,
        actions[index],
        actions[index] === 'rejected'
          ? 'Thời điểm dự án chưa phù hợp'
          : done ? 'Đồng ý' : '',
        done ? `${year}-06-${String(16 + index).padStart(2, '0')} 09:00:00` : null
      );
    }
  }

  const notification = db.prepare(`
    INSERT INTO notifications (user_id, title, body, link, is_read)
    VALUES (?, ?, ?, ?, ?)
  `);
  await notification.run(
    userByName['Nguyễn Văn A'],
    'Đơn LR0002 đã qua bước trưởng nhóm',
    'Đơn đang chờ trưởng phòng xem xét.',
    'requests',
    0
  );
  await notification.run(
    userByName['Nguyễn Văn A'],
    'Đơn LR0001 đã hoàn tất',
    'Đơn nghỉ phép của bạn đã được HR xác nhận.',
    'requests',
    1
  );
  await notification.run(
    userByName['Trần Thị B'],
    'Có đơn mới chờ duyệt',
    'Hai đơn đang chờ trưởng phòng xử lý.',
    'approvals',
    0
  );
  await notification.run(
    userByName['Phạm Thị HR'],
    'Đơn LR0006 chờ xác nhận',
    'Vui lòng kiểm tra và xác nhận đơn nghỉ phép.',
    'approvals',
    0
  );
}

module.exports = seed;
