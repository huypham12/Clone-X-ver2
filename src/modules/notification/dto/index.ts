import { SuccessResponseDto } from '~/common/success-response.dto'
import { Notification } from '~/schemas'

export class GetNotificationsResponseDto extends SuccessResponseDto<any> {
  constructor(statusCode: number, message: string, data: any) {
    super(statusCode, message, data)
  }
}

export class NotificationResponseDto extends SuccessResponseDto<any> {
  constructor(statusCode: number, message: string, data: any) {
    super(statusCode, message, data)
  }
}
