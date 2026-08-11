import { NotificationType } from '~/constants/enums'

export const SUPPRESSED_NOTIFICATION_TYPES = [NotificationType.Message, NotificationType.MessageReaction] as const

export type EligibleNotificationType = Exclude<
  NotificationType,
  NotificationType.Message | NotificationType.MessageReaction
>

export const isEligibleNotificationType = (type: NotificationType): type is EligibleNotificationType =>
  type !== NotificationType.Message && type !== NotificationType.MessageReaction

export const getEligibleNotificationTypeFilter = () => ({
  $nin: [...SUPPRESSED_NOTIFICATION_TYPES]
})
