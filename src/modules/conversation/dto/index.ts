import { SuccessResponseDto } from '~/common/success-response.dto'
import DirectConversation from '~/schemas/DirectConversation.schema'
import GroupConversation from '~/schemas/GroupConversation.schema'
import Message from '~/schemas/Message.schema'

export class CreateGroupConversationBodyDto {
  constructor(
    public name: string,
    public members: string[],
    public avatar_url?: string
  ) {}
}

export class ReactMessageBodyDto {
  constructor(
    public emoji: string
  ) {}
}

export class PaginationQueryDto {
  constructor(
    public page: number,
    public limit: number
  ) {}
}

export class GetConversationsResponseDto extends SuccessResponseDto<any> {
  constructor(statusCode: number, message: string, data: any) {
    super(statusCode, message, data)
  }
}

export class ConversationResponseDto extends SuccessResponseDto<any> {
  constructor(statusCode: number, message: string, data: any) {
    super(statusCode, message, data)
  }
}

export class GetMessagesResponseDto extends SuccessResponseDto<any> {
  constructor(statusCode: number, message: string, data: any) {
    super(statusCode, message, data)
  }
}

export class MessageActionResponseDto extends SuccessResponseDto<any> {
  constructor(statusCode: number, message: string, data: any) {
    super(statusCode, message, data)
  }
}
