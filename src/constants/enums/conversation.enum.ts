export enum MessageKind {
  User = 'user',
  System = 'system'
}

export enum ConversationSystemEventType {
  GroupCreated = 'group_created',
  MemberAdded = 'member_added',
  MemberLeft = 'member_left',
  MemberKicked = 'member_kicked',
  AdminGranted = 'admin_granted',
  AdminRevoked = 'admin_revoked',
  AdminTransferredAndLeft = 'admin_transferred_and_left'
}
