export enum NotificationType {
  Like = 'like',
  Reply = 'reply',
  Retweet = 'retweet',
  Quote = 'quote',
  Follow = 'follow',
  Mention = 'mention',
  System = 'system',
  Message = 'message',
  MessageReply = 'message_reply',
  MessageMention = 'message_mention',
  MessageReaction = 'message_reaction',
  GroupAdd = 'group_add',
  GroupJoin = 'group_join',
  GroupKick = 'group_kick',
  AdminGranted = 'admin_granted',
  AdminRevoked = 'admin_revoked',
  FollowedUserTweet = 'followed_user_tweet'
}

export enum NotificationTargetType {
  User = 'USER',
  Tweet = 'TWEET',
  Message = 'MESSAGE',
  Conversation = 'CONVERSATION'
}
