interface EmailTemplateOptions {
  title: string
  description: string
  buttonText: string
  buttonUrl: string
  footerNote?: string
}

export function getEmailTemplate({ title, description, buttonText, buttonUrl, footerNote }: EmailTemplateOptions) {
  return `
    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
      <h2 style="color: #2c3e50;">${title}</h2>
      <p>${description}</p>
      <p>
        <a href="${buttonUrl}" style="display: inline-block; padding: 10px 20px; background-color: #4a90e2; color: #fff; text-decoration: none; border-radius: 4px;">
          ${buttonText}
        </a>
      </p>
      <p>Nếu bạn không thực hiện yêu cầu này, bạn có thể bỏ qua email này.</p>
      <hr style="margin-top: 30px;" />
      <p style="font-size: 0.85em; color: #777;">
        Đây là email tự động từ hệ thống của <strong>X</strong> – Nền tảng share video. <br />
        Nếu bạn có bất kỳ câu hỏi nào, vui lòng liên hệ bộ phận hỗ trợ. <br /><br />
        ${footerNote ?? 'Cảm ơn bạn đã sử dụng dịch vụ của chúng tôi!'}
      </p>
    </div>
  `
}

export function getVerifyEmailTemplate(token: string) {
  const verifyUrl = `http://localhost:3000/auth/verify-email?token=${token}`

  return getEmailTemplate({
    title: 'Xin chào,',
    description:
      'Bạn đã đăng ký tài khoản tại <strong>X</strong>. Vui lòng xác nhận email của bạn bằng cách nhấn vào nút bên dưới:',
    buttonText: 'Xác nhận địa chỉ email',
    buttonUrl: verifyUrl
  })
}

export function getForgotPasswordTemplate(token: string) {
  const resetPasswordUrl = `http://localhost:3000/auth/reset-password?token=${token}`

  return getEmailTemplate({
    title: 'Xin chào,',
    description:
      'Bạn (hoặc ai đó) đã yêu cầu đặt lại mật khẩu cho tài khoản tại <strong>X</strong>. Nhấn vào nút bên dưới để tiến hành đặt lại mật khẩu:',
    buttonText: 'Đặt lại mật khẩu',
    buttonUrl: resetPasswordUrl
  })
}
