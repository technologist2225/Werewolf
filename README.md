# Web Quản Trò Ma Sói

Web tự động hoá công việc của quản trò trong game Ma Sói offline: chia phòng,
chia vai ngẫu nhiên theo số lượng người chơi, xử lý hành động ban đêm
(Sói / Tiên Tri / Bảo Vệ / Phù Thủy), tổng kết đêm, bỏ phiếu treo cổ ban ngày
và xác định phe chiến thắng.

## Cài đặt & chạy thử

```bash
pip install -r requirements.txt
python app.py
```

Mặc định server chạy tại `http://127.0.0.1:5000`.

- Máy tính/điện thoại của quản trò và người chơi cần **cùng một mạng Wi‑Fi**.
- Quản trò mở `http://<IP-máy-chủ>:5000/` để tạo phòng.
- Mỗi người chơi mở cùng địa chỉ trên điện thoại của mình để vào phòng bằng mã 4 số.
- (Để lấy IP máy chủ trong mạng LAN: `ipconfig` trên Windows hoặc `ifconfig`/`ip addr` trên macOS/Linux.)

## Cấu trúc dự án

```
app.py                  # Toàn bộ backend Flask + logic trò chơi
templates/
  index.html            # Trang chủ: tạo phòng / vào phòng
  host.html             # Bàn quản trò: điều hành đêm/ngày, xem kết quả
  player.html           # Màn hình người chơi: xem vai trò, thao tác ban đêm
static/
  css/style.css         # Giao diện
  js/common.js          # Tiện ích dùng chung + mô tả vai trò
  js/host.js            # Logic trang quản trò
  js/player.js          # Logic trang người chơi
```

## Danh sách API

| Giai đoạn | API | Method | Endpoint |
|---|---|---|---|
| Khởi tạo | Tạo phòng | POST | `/api/create-room` |
| Khởi tạo | Tham gia phòng | POST | `/api/join-room` |
| Khởi tạo | Bắt đầu game | POST | `/api/start-game` |
| Ban đêm | Ma Sói cắn | POST | `/api/wolf-action` |
| Ban đêm | Tiên Tri soi | POST | `/api/seer-action` |
| Ban đêm | Bảo Vệ che chở | POST | `/api/guard-action` |
| Ban đêm | Phù Thủy dùng thuốc | POST | `/api/witch-action` |
| Rạng sáng | Tổng kết đêm | POST | `/api/resolve-night` |
| Ban ngày | Bỏ phiếu treo cổ | POST | `/api/vote-hang` |
| Kết thúc | Kiểm tra thắng thua | POST | `/api/check-win` |
| Hỗ trợ | Trạng thái phòng (public) | GET | `/api/room-state` |
| Hỗ trợ | Toàn bộ vai trò (chỉ quản trò) | GET | `/api/host-view` |
| Hỗ trợ | Vai trò của riêng tôi | GET | `/api/my-role` |

Chi tiết từng API nằm trong docstring/route tương ứng ở `app.py`.

## Cách chia vai theo số người

Áp dụng đúng bảng thiết lập đã thiết kế: 5‑6 người (Sói, Tiên Tri, Phù Thủy,
Dân Làng), 8‑9, 10‑11, 12‑13, 14, 15, 16, 17, 18 người với các vai bổ sung
(Bảo Vệ, Thợ Săn, Thần Tình Yêu, Trưởng Làng, Thổi Sáo, Ăn Trộm, Phản Bội...).
Trên 18 người, hệ thống tự mở rộng thêm Sói và Dân Làng theo tỉ lệ hợp lý.
7 người (không có trong bảng gốc) được nội suy: Sói, Tiên Tri, Bảo Vệ, Phù Thủy
+ Dân Làng.

## Những điều đã sửa/cải tiến so với bản nháp ban đầu

- **Sửa lỗi Phù Thủy**: bản gốc dùng chung `guard_target` cho cả Bảo Vệ và bình
  cứu của Phù Thủy, khiến hai vai trò ghi đè lẫn nhau. Bản này tách riêng
  `guard_target`, `witch_save_target`, `witch_kill_target`.
- **Giới hạn dùng thuốc**: mỗi bình (cứu/độc) của Phù Thủy chỉ dùng được **một
  lần duy nhất cho cả ván**, đúng luật.
- **Kiểm tra vai trò khi hành động**: mỗi API đêm đều xác thực người gọi đúng
  là vai trò tương ứng và còn sống, tránh giả mạo hành động.
- **Máy trạng thái pha chơi** (`lobby → night → day → ended`) để mọi API chỉ
  hoạt động đúng thời điểm của nó.
- **Tự động kiểm tra thắng/thua** sau mỗi lần tổng kết đêm và mỗi lần treo cổ,
  gắn nhãn `VICTORY` / `LOSE` cho từng người chơi theo đúng yêu cầu thiết kế.
- **Giao diện đầy đủ**: trang chủ tạo/vào phòng, bàn quản trò theo dõi real-time,
  màn hình riêng cho từng người chơi để thao tác vai trò một cách bí mật.

## Giới hạn hiện tại / hướng mở rộng

Các vai trò đặc biệt khác trong tài liệu thiết kế (Thợ Săn bắn trả, Thần Tình
Yêu ghép đôi, Trưởng Làng 2 phiếu, Thổi Sáo, Ăn Trộm, Phản Bội, Cô Bé...) đã
được **chia vai** đúng số lượng cho các bàn lớn, nhưng hành động riêng của họ
chưa có API tự động (không có trong danh sách API gốc) — quản trò cần điều
hành trực tiếp bằng lời khi các vai này cần thao tác đặc biệt.

Dữ liệu phòng lưu trong RAM, mất khi tắt server — phù hợp cho một buổi chơi.
Muốn lưu nhiều bàn cùng lúc lâu dài hơn thì có thể thay bằng Redis/SQLite.
