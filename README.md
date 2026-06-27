# LeaveSystem MySQL — Hệ thống quản lý nghỉ phép

Phiên bản này lưu toàn bộ dữ liệu trong MySQL Server. Không còn sử dụng file SQLite `.db`.

## Điểm mới trong bản giao diện

- Nâng cấp giao diện theo phong cách hiện đại hơn: card bo góc mềm, bảng dễ đọc, sidebar và topbar có hiệu ứng nổi nhẹ.
- Có nút chuyển Light/Dark mode ở màn hình đăng nhập và sau khi đăng nhập.
- Lựa chọn giao diện được lưu trong trình duyệt, lần sau mở lại sẽ tự giữ màu đã chọn.

## Chức năng nâng cấp thêm

- Kiểm tra đơn nghỉ trước khi gửi: tự tính số ngày làm việc, số phép khả dụng và số phép còn lại sau khi gửi.
- Cảnh báo nếu đơn mới bị trùng với đơn nghỉ đã có của chính người dùng.
- Hiển thị lịch nghỉ trùng trong cùng phòng ban để người gửi/duyệt dễ cân đối nhân sự.
- Lọc đơn theo từ khóa, trạng thái, khoảng ngày và phòng ban; HR có màn hình lọc toàn bộ đơn tập trung.
- Chọn năm để xem số dư phép của cá nhân hoặc toàn công ty.
- Đánh dấu từng thông báo đã đọc, xóa từng thông báo hoặc xóa toàn bộ thông báo đã đọc.
- Xuất CSV cho danh sách đơn nghỉ của tôi, đơn chờ duyệt, toàn bộ đơn nghỉ, nhân viên, số dư phép và báo cáo.
- File CSV của đơn nghỉ tự áp dụng đúng trạng thái, khoảng ngày và phòng ban đang chọn.
- Các file CSV có BOM UTF-8 nên mở bằng Excel sẽ ít bị lỗi tiếng Việt hơn.

## Cơ cấu phòng ban và phân cấp duyệt

- Mỗi nhân sự được gán một **chức vụ** và một **phòng ban** riêng.
- Mỗi phòng ban có thể chỉ định một **trưởng nhóm phụ trách** và một **trưởng phòng phụ trách**.
- Người được phân công phải đang hoạt động, có đúng chức vụ và thuộc chính phòng ban đó.
- Trang `Quản trị hệ thống → Phòng ban` có sơ đồ từng phòng, người phụ trách và danh sách thành viên.
- Khi đổi chức vụ, chuyển phòng hoặc khóa tài khoản quản lý, hệ thống tự gỡ phân công cũ và cập nhật các đơn chưa xử lý.
- Trưởng nhóm/trưởng phòng chỉ nhận đúng đơn được giao của phòng mình, không thể duyệt thay người quản lý đã được chỉ định.

Luồng duyệt được rút gọn theo chức vụ người gửi:

| Người gửi | Luồng phê duyệt |
|---|---|
| Nhân viên | Trưởng nhóm (nếu có) → Trưởng phòng → HR |
| Trưởng nhóm | Trưởng phòng → HR |
| Trưởng phòng | HR |
| HR | Quản trị viên |

Phòng ban phải có trưởng phòng hợp lệ trước khi nhân viên hoặc trưởng nhóm gửi đơn. Màn hình xem trước đơn sẽ hiển thị toàn bộ cấp duyệt và người phụ trách.

Trang `Đơn chờ duyệt` có thêm lịch sử 100 quyết định gần nhất của người đăng nhập. Chi tiết mỗi đơn hiển thị từng cấp, người được giao, thời gian, kết quả và nhận xét.

## Cấu trúc source

```text
LeaveSystem_MySQL/
├── server.js                 # Điểm khởi động
├── db.js                     # File tương thích, chuyển tới src/database
├── database.sql              # Cấu trúc MySQL
├── src/
│   ├── app.js                # HTTP server
│   ├── auth.js               # Xác thực và phân quyền
│   ├── http.js               # Đọc request, trả response, static files
│   ├── leave-utils.js        # Nghiệp vụ dùng chung cho đơn nghỉ
│   ├── security.js           # Mã hóa và kiểm tra mật khẩu
│   ├── constants.js
│   ├── database/
│   │   ├── index.js          # Connection pool và transaction
│   │   ├── config.js         # Đọc .env
│   │   └── seed.js           # Dữ liệu mẫu
│   └── routes/
│       ├── auth-dashboard.js
│       ├── requests.js
│       ├── employee.js
│       ├── hr.js
│       ├── admin.js
│       └── index.js
├── public/
│   ├── index.html
│   ├── styles.css
│   └── js/
│       ├── core.js
│       ├── main.js
│       └── pages/
│           ├── employee.js
│           ├── hr.js
│           └── admin.js
├── scripts/
└── tests/
```

Khi thêm API mới, đặt route vào đúng file nghiệp vụ trong `src/routes`. Khi thêm màn hình mới, đặt hàm render vào nhóm tương ứng trong `public/js/pages`.

## Yêu cầu

- Node.js 20 trở lên.
- MySQL 8.0 trở lên hoặc MariaDB tương thích.
- Tài khoản MySQL có quyền tạo database và bảng.

## Cài đặt nhanh trên Windows

1. Cài và khởi động MySQL.
2. Nhấp đúp `start-website.bat`.
3. Lần chạy đầu, chương trình cài thư viện và tạo file `.env`.
4. Mở `.env`, điền tài khoản MySQL:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=leave_management
DB_USER=root
DB_PASSWORD=mat_khau_mysql
DB_AUTO_CREATE=true
DB_AUTO_SEED=true
```

5. Chạy lại `start-website.bat`.
6. Mở `http://127.0.0.1:3000`.

## Cài đặt bằng dòng lệnh

```powershell
Copy-Item .env.example .env
npm install
npm start
```

Ứng dụng tự tạo database, cấu trúc bảng và dữ liệu demo nếu tài khoản MySQL có quyền.

Nếu dùng database từ phiên bản cũ, ứng dụng sẽ tự bổ sung trường phân công trưởng nhóm/trưởng phòng và mở rộng cấp duyệt khi khởi động. Nên sao lưu MySQL trước lần chạy đầu tiên.

## Import bằng phpMyAdmin hoặc MySQL Workbench

Nếu tài khoản MySQL không có quyền `CREATE DATABASE`:

1. Import file `database.sql`.
2. Đặt `DB_AUTO_CREATE=false` trong `.env`.
3. Giữ `DB_AUTO_SEED=true` để ứng dụng tự thêm dữ liệu mẫu.
4. Chạy `npm start`.

Nếu đổi tên database khi import, cập nhật cả `DB_NAME` trong `.env`.

## Tài khoản demo

Mật khẩu chung: `123456`.

| Vai trò | Tên đăng nhập |
|---|---|
| Nhân viên | `nhanvien01` |
| Trưởng nhóm | `leader01` |
| Trưởng phòng | `manager01` |
| Trưởng nhóm Kinh doanh | `leader02` |
| Trưởng phòng Kinh doanh | `manager02` |
| Trưởng nhóm Marketing | `leader03` |
| Trưởng phòng Marketing | `manager03` |
| Nhân sự HR | `hr01` |
| Quản trị viên | `admin` |

## Chuyển dữ liệu từ bản SQLite cũ

Nếu muốn giữ lại dữ liệu đang có, hãy dùng một MySQL database trống và chạy:

```powershell
npm run migrate:sqlite -- "C:\duong-dan\leave-management.db"
```

Lệnh này yêu cầu Node.js 22.5 trở lên vì sử dụng trình đọc SQLite tích hợp của Node.js. Toàn bộ nhân viên, mật khẩu đã mã hóa, đơn nghỉ, lịch sử duyệt, số dư, ngày lễ, thông báo và audit log sẽ được chuyển sang MySQL. Các phiên đăng nhập cũ không được chuyển.

## Các bảng MySQL

- `departments`
- `users`
- `leave_types`
- `leave_balances`
- `leave_requests`
- `approvals`
- `holidays`
- `notifications`
- `sessions`
- `audit_logs`

Các bảng dùng InnoDB, khóa ngoại, index và bảng mã `utf8mb4`.

## Cấu hình

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `HOST` | Địa chỉ website lắng nghe | `127.0.0.1` |
| `PORT` | Cổng website | `3000` |
| `DB_HOST` | Máy chủ MySQL | `127.0.0.1` |
| `DB_PORT` | Cổng MySQL | `3306` |
| `DB_NAME` | Tên database | `leave_management` |
| `DB_USER` | Tài khoản MySQL | `root` |
| `DB_PASSWORD` | Mật khẩu MySQL | trống |
| `DB_CONNECTION_LIMIT` | Số connection tối đa | `10` |
| `DB_AUTO_CREATE` | Tự tạo database | `true` |
| `DB_AUTO_SEED` | Tự thêm dữ liệu demo | `true` |

## Kiểm tra source

```powershell
npm run check
npm test
```

`npm test` mặc định kiểm tra source và cấu trúc SQL. Nếu máy đang có MySQL test, đặt `MYSQL_INTEGRATION_TEST=true` để chạy kiểm thử API đầy đủ.

## Triển khai

Khi chạy thật:

- Dùng tài khoản MySQL riêng, không nên dùng `root`.
- Đặt website sau HTTPS/reverse proxy.
- Sao lưu database định kỳ bằng `mysqldump`.
- Đặt `DB_AUTO_SEED=false` sau khi đã có dữ liệu chính thức.
