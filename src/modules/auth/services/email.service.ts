import sgMail from '@sendgrid/mail'
import { envConfig } from '~/config/getEnvConfig'
import { ResendVerifyEmailResponseDto } from '../dto'

interface SendEmailOptions {
  to: string
  subject: string
  text?: string
  html?: string
}

export class EmailService {
  private readonly senderEmail: string

  constructor() {
    // Khởi tạo SendGrid API key
    sgMail.setApiKey(envConfig.sendGrid.apiKey as string)
    this.senderEmail = 'huy9008437@gmail.com' // Phải là email đã verify với SendGrid
  }

  async sendEmail({ to, subject, text, html }: SendEmailOptions): Promise<ResendVerifyEmailResponseDto> {
    const content: { type: string; value: string }[] = []

    if (text) {
      content.push({ type: 'text/plain', value: text })
    }

    if (html) {
      content.push({ type: 'text/html', value: html })
    }

    // Đảm bảo content không rỗng
    if (content.length === 0) {
      content.push({ type: 'text/plain', value: subject })
    }

    const msg = {
      to,
      from: this.senderEmail,
      subject,
      content: content as [{ type: string; value: string }, ...{ type: string; value: string }[]]
    }

    try {
      await sgMail.send(msg)
      console.log('Email sent to:', to)
      return new ResendVerifyEmailResponseDto()
    } catch (error: any) {
      console.error('Error sending email:', error.response?.body || error.message)
      throw error
    }
  }
}
