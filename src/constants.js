const ROLE_LABELS = {
  employee: 'Nhân viên',
  leader: 'Trưởng nhóm',
  manager: 'Trưởng phòng',
  hr: 'Nhân sự HR',
  admin: 'Quản trị viên'
};

const STATUS_LABELS = {
  pending_leader: 'Chờ trưởng nhóm',
  pending_manager: 'Chờ trưởng phòng',
  pending_hr: 'Chờ HR xác nhận',
  approved: 'Đã duyệt',
  rejected_by_leader: 'Trưởng nhóm từ chối',
  rejected_by_manager: 'Trưởng phòng từ chối',
  rejected_by_hr: 'HR từ chối',
  cancelled: 'Đã hủy'
};

module.exports = { ROLE_LABELS, STATUS_LABELS };
