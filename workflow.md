# Quy Trình Triển Khai Dự Án Phần Mềm Vừa Và Lớn (Tối Ưu Hóa)

Quy trình này tập trung vào tính rõ ràng, linh hoạt, dễ bảo trì, hỗ trợ công nghệ mới và sử dụng AI để tăng tốc độ. Đã tối ưu bằng cách gộp bước nghiên cứu, thêm testing/iteration, và tích hợp security/check feasibility sớm.

## Bước 1: Phân Tích Và Thiết Kế Độc Lập Với Công Nghệ

- Xác định use case, xây dựng schema cơ sở dữ liệu, quan hệ dữ liệu.
- Vẽ biểu đồ tuần tự (sequence diagrams) và thiết kế endpoint workflows (ví dụ: cho API 'user/me' – check auth → lấy dữ liệu DB → trả về response).
- Thêm kiểm tra sơ bộ tính khả thi (spike nhanh cho yêu cầu phức tạp như scalability).
- Đảm bảo bao gồm security basics (auth, privacy) ở mức logic.

## Bước 2: Xác Định Công Nghệ Chính Và Mục Đích Sử Dụng

- Liệt kê công nghệ cho từng phần (ví dụ: endpoint 'media/upload' – busboy cho parsing, HLS cho streaming, S3 cho storage).
- Xác định mục đích cụ thể (khoanh vùng tính năng: busboy chỉ dùng cho multipart upload, không học toàn bộ).
- Hỏi AI (như Grok) về các phần cần học để tránh lan man.

## Bước 3: Xây Dựng Khung Kiến Thức Và Khoanh Vùng Nội Dung Cần Thiết

- Lấy tổng quan công nghệ (ví dụ: socket.io – hiểu event listening, emitting, namespaces).
- Khoanh vùng chỉ kiến thức liên quan đến dự án (dùng AI để filter: "Cần học gì về socket.io cho real-time chat?").
- Tránh học sâu không cần thiết; ưu tiên hiểu cách hoạt động hơn syntax.

## Bước 4: Học Sâu Và Gen Code Với AI Hỗ Trợ

- Học chi tiết từng tính năng (kết hợp docs chính thức và AI chat để giải thích workflow).
- Sử dụng AI gen code theo workflow (ví dụ: "Gen code Node.js dùng busboy cho upload file to S3"), nhưng hiểu rõ trước khi apply.
- Thực hành trên prototype nhỏ để verify.

## Bước 5: Tích Hợp Công Nghệ Vào Dự Án

- Lắp ráp công nghệ vào endpoint đã thiết kế (dùng modular code để dễ thay đổi).
- Đảm bảo tích hợp mượt mà với phần còn lại (ví dụ: kết nối DB với API).

## Bước 6: Testing, Review Và Iteration

- Thực hiện unit/integration/end-to-end testing (dùng AI gen test cases nếu cần).
- Code review bởi team; fix bugs và optimize.
- Iteration: Nếu vấn đề phát sinh (công nghệ không phù hợp), quay lại bước 2-3 với feedback.

## Bước 7: Ghi Chú, Tạo Docs Và Bảo Trì

- Tạo docs chi tiết (API specs với Swagger, code comments, architecture diagrams).
- Ghi chú lessons learned, best practices cho công nghệ mới.
- Thiết lập monitoring (logs, metrics) để dễ bảo trì lâu dài.

## Lưu Ý Chung

- Áp dụng Agile: Chia thành sprints cho dự án lớn.
- Thời gian ước tính: 20-30% cho thiết kế, 40% cho học/tích hợp, 30% cho test/docs.
- Rủi ro: Review AI-generated code kỹ để tránh lỗi.
- Phù hợp: Team nhỏ/startup; doanh nghiệp lớn có thể tích hợp vào DevOps.

# Quy tắc prompt

## 1: Vai trò (Role): Yêu cầu AI nhập vai một chuyên gia hoặc persona cụ thể phù hợp với chủ đề.

- Mục đích: Giúp AI tập trung và trả lời với góc nhìn chuyên sâu, giảm câu trả lời chung chung.
  Ví dụ: "Bạn là một nhà khoa học dữ liệu có 10 năm kinh nghiệm" hoặc "Bạn là một đầu bếp chuyên món Á châu".

## 2: Nhiệm vụ (Task): Mô tả rõ ràng, cụ thể nhiệm vụ chính mà AI cần thực hiện.

- Mục đích: Sử dụng động từ hành động để định hướng (analyze, generate, summarize). Chỉ rõ input/output mong đợi.
- Ví dụ: "Phân tích dữ liệu từ file CSV và đưa ra khuyến nghị" hoặc "Viết một bài blog về chủ đề X".

## 3: Ngữ cảnh (Context): Cung cấp thông tin nền tảng cần thiết, bao gồm dữ liệu, sự kiện hoặc giả định liên quan.

- Mục đích: Giúp AI không cần "đoán mò", nhưng giữ ngắn gọn để tránh overload.
- Ví dụ: "Dựa trên dữ liệu từ năm 2023, với dân số Việt Nam là 100 triệu người".

## 4:Lập luận (Reasoning): Yêu cầu AI suy nghĩ từng bước (step-by-step), với tính rõ ràng, khoa học, dựa trên dẫn chứng thực tế hoặc logic.

- Mục đích: Tăng độ chính xác, khuyến khích Chain of Thought. Xử lý trường hợp không chắc chắn (ví dụ: "Nếu không có dữ liệu, hãy nêu rõ và đề xuất cách tìm kiếm").
- Ví dụ: "Giải thích từng bước: 1. Định nghĩa khái niệm. 2. Liệt kê lợi ích với dẫn chứng từ nguồn uy tín. 3. Thảo luận rủi ro".

## 5: Ví dụ (Examples): Cung cấp 1-3 ví dụ minh họa input-output để AI học theo pattern (few-shot prompting).

- Mục đích: Đặc biệt hữu ích cho nhiệm vụ phức tạp hoặc sáng tạo, giúp AI hiểu kỳ vọng.
  Ví dụ:
- Input: "Lợi ích của ăn chay."
- Output: "1. Giảm cân (nghiên cứu X). 2. Tốt cho tim (dẫn chứng Y)."

## 6: Ràng buộc (Constraints): Đặt giới hạn để kiểm soát output, bao gồm độ dài, ngôn ngữ, giọng điệu hoặc cách xử lý lỗi/bias.

- Mục đích: Tránh trả lời dài dòng, sai lệch hoặc không phù hợp.
- Ví dụ: "Trả lời bằng tiếng Việt, không vượt quá 500 từ, tránh thông tin sai lệch, và giữ giọng điệu trung lập".

## 1: Định dạng đầu ra (Output Format): Chỉ định cấu trúc output mong muốn để dễ đọc và sử dụng.

- Mục đích: Sử dụng markdown, bullet points, bảng hoặc JSON nếu cần.
- Ví dụ: "Trả lời theo dạng:
  Tiêu đề
  Đoạn 1: Mô tả
  Đoạn 2: Phân tích
  Bảng tóm tắt
  Kết luận".
