export function getVerifyEmailTemplate(token: string) {
  const verifyUrl = `http://localhost:3000/auth/verify-email?token=${token}`

  return `
    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
      <h2 style="color: #2c3e50;">Xin chào,</h2>
      <p>Bạn đã đăng ký tài khoản tại <strong>X</strong>. Để hoàn tất quá trình, vui lòng xác nhận email của bạn bằng cách nhấn vào nút bên dưới:</p>
      <p>
        <a href="${verifyUrl}" style="display: inline-block; padding: 10px 20px; background-color: #4a90e2; color: #fff; text-decoration: none; border-radius: 4px;">
          Xác nhận địa chỉ email
        </a>
      </p>
      <p>Nếu bạn không thực hiện yêu cầu này, bạn có thể bỏ qua email này.</p>
      <hr style="margin-top: 30px;" />
      <p style="font-size: 0.85em; color: #777;">
        Đây là email tự động từ hệ thống của <strong>X</strong> – Nền tảng share video. <br />
        Nếu bạn có bất kỳ câu hỏi nào, vui lòng liên hệ bộ phận hỗ trợ. <br /><br />
        Cảm ơn bạn đã sử dụng dịch vụ của chúng tôi!
      </p>
    </div>
  `
}
