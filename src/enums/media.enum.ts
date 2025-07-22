export enum MediaType {
  Image,
  Video,
  Icon
}

export type Media = {
  url: string
  type: MediaType
}
