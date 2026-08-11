export enum MediaType {
  Image = 'image',
  Video = 'video',
  Sticker = 'sticker',
  Audio = 'audio'
}

export enum MediaStatus {
  Pending = 'pending',
  Ready = 'ready',
  Failed = 'failed'
}

export type Media = {
  url: string
  type: MediaType
}
