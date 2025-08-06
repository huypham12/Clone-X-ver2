import sgMail from '@sendgrid/mail'
import { envConfig } from '~/config/getEnvConfig'
import { SendEmailResponseDto } from '../dto'
import { MESSAGES } from '~/constants/messages'

interface SendEmailOptions {
  to: string
  subject: string
  text?: string
  html?: string
}

export class EmailService {
  private readonly senderEmail: string

  constructor() {
    sgMail.setApiKey(envConfig.sendGrid.apiKey as string)
    this.senderEmail = 'huy9008437@gmail.com'
  }

  async sendEmail({ to, subject, text, html }: SendEmailOptions, message: string): Promise<SendEmailResponseDto> {
    const msg = {
      to,
      from: this.senderEmail,
      subject,
      text: text ?? subject, // fallback nếu không truyền text
      html
    }

    try {
      await sgMail.send(msg)
      console.log('Email sent to:', to)
      return new SendEmailResponseDto(message)
    } catch (error: any) {
      console.error('SendGrid error:', error.response?.body || error.message)
      throw new Error('Gửi email thất bại.')
    }
  }
}
