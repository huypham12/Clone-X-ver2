export enum MediaType {
  Image = 'image',
  Video = 'video',
  Sticker = 'sticker',
  Audio = 'audio'
}

export type Media = {
  url: string
  type: MediaType
}
