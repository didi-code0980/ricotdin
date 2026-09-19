# Ricotdin — Product Brief

**Sản phẩm:** Trợ lý cuộc họp bằng AI
**Phiên bản tài liệu:** 1.0 · 2026-08-25
**Trạng thái:** 69/98 tính năng hoàn thành — luồng nghiệp vụ chính đã chạy đầu-cuối

---

## 1. Tóm tắt điều hành

Ricotdin biến một cuộc họp online thành tài sản tra cứu được. Người dùng bấm ghi âm ngay
trong trình duyệt; hệ thống trả về biên bản có dấu thời gian, bản tóm tắt, danh sách việc
cần làm và các mốc lịch được nhắc tới. Sau đó họ có thể **hỏi đáp bằng ngôn ngữ tự nhiên**
trên toàn bộ kho họp cũ, và mọi câu trả lời đều kèm trích dẫn tới đúng thời điểm trong
biên bản.

Sản phẩm định vị **Vietnamese-first**, hỗ trợ tiếng Việt và tiếng Anh, chạy trên hạ tầng
tự vận hành để kiểm soát chi phí và dữ liệu.

---

## 2. Vấn đề

Sau mỗi cuộc họp online, một lượng lớn giá trị bị bốc hơi:

| Vấn đề | Hệ quả |
|---|---|
| Ghi biên bản thủ công | Tốn 20–40 phút mỗi cuộc, người ghi không tập trung họp được |
| Cam kết miệng không được ghi lại | Việc rơi rụng, không ai chịu trách nhiệm |
| Không tra cứu được họp cũ | "Hôm trước anh nói gì về ngân sách?" — không ai trả lời được |
| Bản ghi âm dài, không ai nghe lại | File nằm chết trong ổ đĩa |

Các công cụ hiện có hoặc quá đắt cho thị trường Việt Nam, hoặc phiên âm tiếng Việt kém,
hoặc buộc phải đẩy toàn bộ dữ liệu họp lên nền tảng của bên thứ ba.

---

## 3. Đối tượng người dùng

**Người dùng cuối** — nhân viên và quản lý họp qua Google Meet / Zoom / Teams trên trình
duyệt. Cần biên bản, cần nhớ việc, cần tra cứu lại.

**Quản trị viên** — người vận hành hệ thống trong doanh nghiệp. Cần kiểm soát chi phí AI,
quản lý tài khoản, phân bổ hạn mức và theo dõi sức khoẻ hệ thống.

---

## 4. Giá trị cốt lõi

| Cam kết | Cách thực hiện |
|---|---|
| **Không bỏ sót** | Mọi lời nói được ghi lại; mọi cam kết được trích thành to-do có người phụ trách và hạn chót |
| **Tra cứu tức thì** | Hỏi đáp ngôn ngữ tự nhiên trên một cuộc họp, nhiều cuộc họp, hoặc một thư mục |
| **Không bịa** | Chatbot chỉ trả lời từ nội dung biên bản; không tìm thấy thì nói không tìm thấy. Không bịa giờ cho lịch hẹn |
| **Riêng tư theo thiết kế** | Chỉ lưu âm thanh, bỏ hình. Mỗi người chỉ thấy dữ liệu của mình trừ khi chủ động chia sẻ |
| **Chi phí minh bạch** | Hạn mức trả trước theo ví; bảng theo dõi mức tiêu thụ AI theo từng người dùng |

---

## 5. Luồng sử dụng chính

```
Ghi âm / Tải file lên
        ↓
Xử lý tự động  →  biên bản · tóm tắt · ghi chú · to-do · mốc lịch
        ↓
Xem & thao tác  →  nghe lại đúng đoạn · tick việc · xuất .ics
        ↓
Tra cứu         →  hỏi đáp có trích dẫn, xuyên nhiều cuộc họp
        ↓
Chia sẻ         →  gom vào thư mục, chia sẻ cho đồng nghiệp
```

---

## 6. Tính năng

### 6.1 Ghi âm & nạp dữ liệu

- Ghi trực tiếp trong trình duyệt, **trộn âm thanh cuộc họp + micro** thành một luồng —
  bắt được cả hai chiều hội thoại.
- **Chỉ lưu âm thanh**, loại bỏ hình ngay lập tức.
- Cảnh báo rõ ràng khi trình duyệt không hỗ trợ hoặc người dùng quên bật "share audio".
- **Tải lên file có sẵn**: mp3, m4a, wav, aac, ogg, flac, webm — tối đa 500 MB. File video
  bị từ chối.
- Chọn ngày họp khi tải lên, để AI hiểu đúng mốc thời gian tương đối ("thứ Ba tuần sau").

### 6.2 Xử lý tự động

- **Biên bản có dấu thời gian và phân biệt người nói.**
- **Tóm tắt và ghi chú cuộc họp** có cấu trúc.
- **Trích xuất to-do** kèm người phụ trách và hạn hoàn thành.
- **Trích xuất mốc lịch** được nhắc tới trong cuộc họp.
- Hỗ trợ họp dài: tự chia nhỏ âm thanh và ghép biên bản lại theo mốc thời gian.
- Trạng thái minh bạch (đang chờ → đang xử lý → xong / lỗi), cho phép chạy lại khi lỗi.

### 6.3 Trang chi tiết cuộc họp

- Một trang gộp đủ: tóm tắt · ghi chú · biên bản đầy đủ · to-do · lịch hẹn.
- **Trình phát audio đồng bộ** — bấm vào một dòng biên bản để nhảy tới đúng đoạn ghi âm.
- Tick hoàn thành / bỏ qua to-do, và nhảy về đoạn hội thoại gốc để đối chiếu ngữ cảnh.
- Xuất biên bản ra file.

### 6.4 Chatbot hỏi đáp

- Ba phạm vi hỏi: **một cuộc họp**, **xuyên nhiều cuộc họp**, **trong một thư mục**.
- Mọi câu trả lời kèm **trích dẫn tới đúng thời điểm** trong biên bản để người dùng tự
  kiểm chứng.
- Lưu lịch sử hội thoại để xem lại.

### 6.5 Lịch & công việc

- Xuất mốc lịch ra file **.ics**, nhập được vào bất kỳ ứng dụng lịch nào.
- **Xử lý thời gian trung thực**: khi thời điểm không rõ ràng, hệ thống để dạng cả ngày
  hoặc tắt chức năng xuất — thà thiếu còn hơn sai.
- Quản lý to-do với người phụ trách và hạn chót; đánh dấu quá hạn.

### 6.6 Quản lý & chia sẻ

- Danh sách cuộc họp kèm trạng thái xử lý.
- **Đổi tên**, **ghim** lên đầu danh sách, **xoá** (xoá kèm file âm thanh).
- **Thư mục** để nhóm cuộc họp, kéo thả sắp xếp thứ tự.
- **Chia sẻ theo thư mục** với hai vai trò: *chỉ xem* và *chỉnh sửa*.

### 6.7 Tài khoản & hồ sơ

- Đăng ký bằng email + mật khẩu, có xác thực email.
- Đăng nhập bằng **email hoặc username**.
- Hai vai trò: người dùng và quản trị viên. Mỗi người chỉ truy cập dữ liệu của mình.
- Trang hồ sơ: thông tin tài khoản, đổi tên hiển thị / username, đổi mật khẩu, ảnh đại
  diện, chọn giao diện sáng/tối.

### 6.8 Khu vực quản trị

| Khu vực | Chức năng |
|---|---|
| **Người dùng** | Danh sách, tìm kiếm, phân trang, đổi vai trò, khoá/mở, đặt lại mật khẩu, xoá, thao tác hàng loạt |
| **Rào chắn an toàn** | Admin không thể tự hạ quyền / khoá / xoá chính mình, và không thể xoá admin cuối cùng |
| **Giám sát xử lý** | Bảng theo trạng thái, phát hiện job treo, xem lỗi, chạy lại đơn lẻ hoặc hàng loạt |
| **Chi phí AI** | Số lượt gọi, token, số giây audio đã phiên âm, tỷ lệ lỗi, biểu đồ theo ngày — tách bạch hai đơn vị đo |
| **Hạn mức** | Ví trả trước: giữ trước khi xử lý → quyết toán khi xong → hoàn lại nếu lỗi |
| **Khoá API** | Thêm / vô hiệu hoá khoá từng nhà cung cấp qua giao diện. Kiểm tra sức khoẻ tự động hằng ngày để phát hiện khoá chết trước khi nó làm hỏng yêu cầu người dùng |
| **Lưu trữ** | Dung lượng audio, phát hiện file mồ côi, dọn dẹp theo chính sách |
| **Cấu hình runtime** | Đổi model mặc định, bật/tắt tính năng, chỉnh ngưỡng — không cần deploy lại |
| **Nhật ký** | Log hành động quản trị và log hành vi người dùng |
| **Sức khoẻ hệ thống** | Trạng thái tổng hợp các thành phần phụ thuộc |

### 6.9 Đa nhà cung cấp AI

Hệ thống không khoá cứng vào một nhà cung cấp. Hỗ trợ nhiều nhà cung cấp cho phần sinh nội
dung và phần phiên âm. Quản trị viên chọn model mặc định; người dùng có thể chọn model khi
tạo cuộc họp. Mỗi cuộc họp ghi nhớ model đã dùng để kết quả nhất quán khi chạy lại.

**Ý nghĩa kinh doanh:** đổi nhà cung cấp khi giá thay đổi hoặc chất lượng tiếng Việt cải
thiện mà không phải viết lại sản phẩm.

---

## 7. Ngoài phạm vi hiện tại

Những thứ **cố ý chưa làm**, để giữ phạm vi gọn:

- Tự động tạo sự kiện trên Google Calendar (hiện chỉ xuất `.ics`)
- Nhắc việc chủ động / thông báo đẩy
- Tự phát hiện ứng dụng họp đang chạy để tự bật ghi âm
- Cộng tác nhiều người theo thời gian thực trên cùng một biên bản

---

## 8. Lộ trình còn lại

**Đã xong:** toàn bộ luồng nghiệp vụ chính (ghi âm → xử lý → xem kết quả → hỏi đáp →
chia sẻ) cùng bộ công cụ quản trị đầy đủ.

### Nhóm A — Bắt buộc trước khi mở ra ngoài

| Hạng mục | Nội dung |
|---|---|
| Pháp lý & riêng tư | Thông báo / xin phép ghi âm; điều khoản sử dụng và chính sách riêng tư |
| Vòng đời dữ liệu | Chính sách lưu trữ và xoá tự động; mã hoá và huỷ audio sau khi xử lý |
| Tuân thủ | Xuất và xoá toàn bộ dữ liệu của một người theo yêu cầu (GDPR-style) |
| Vận hành | Môi trường staging; sao lưu cơ sở dữ liệu định kỳ |

### Nhóm B — Thương mại hoá

- Thanh toán và gói cước thuê bao
- Tách biệt dữ liệu đa tổ chức (multi-tenant)
- Mô hình chi phí và dự báo

### Nhóm C — Mở rộng trải nghiệm

- Email tóm tắt tự động sau cuộc họp
- Đồng bộ Google Calendar hai chiều
- Nhắc việc theo hạn chót
- Đặt tên cho người nói (thay vì "Người nói 1")
- Tìm kiếm toàn thư viện
- Ứng dụng desktop

### Nhóm D — Tài khoản nâng cao

- Đa ngôn ngữ giao diện
- Xác thực hai lớp
- Quản lý thiết bị / phiên đăng nhập
- Thư mục mặc định cho cuộc họp mới

---

## 9. Hạn chế đã biết

**Tua audio với bản ghi từ trình duyệt.** File ghi trực tiếp trong trình duyệt hiện không
hiển thị tổng thời lượng và không kéo tua tự do được — chỉ tua trong phần đã tải. File tải
lên dạng mp3/m4a không gặp vấn đề này.

Đã có giải pháp tạm thời (bật qua cấu hình quản trị, mặc định tắt vì buộc phải tải toàn bộ
file trước khi phát). Cách chữa dứt điểm là chuyển đổi định dạng ngay khi tải lên — chưa
triển khai.

**Mức độ ưu tiên:** thấp. Chỉ nâng lên khi người dùng phàn nàn.

---

## 10. Nguyên tắc thiết kế

Bốn nguyên tắc đã định hình sản phẩm và cần được giữ:

1. **Trung thực hơn đầy đủ.** Không bịa giờ cho lịch hẹn, không bịa câu trả lời cho
   chatbot. Nói "không biết" là một kết quả hợp lệ.
2. **Riêng tư mặc định.** Bỏ hình, chỉ lưu tiếng. Không chia sẻ trừ khi người dùng chủ
   động chia sẻ.
3. **Vận hành được mà không cần lập trình viên.** Đổi model, thêm khoá API, chỉnh hạn
   mức, chạy lại job lỗi — tất cả qua giao diện quản trị, không cần deploy.
4. **Không khoá cứng nhà cung cấp.** Thị trường AI đang biến động nhanh; sản phẩm phải đổi
   được nhà cung cấp mà không phải viết lại.
