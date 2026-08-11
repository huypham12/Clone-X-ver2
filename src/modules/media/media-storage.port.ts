import { MediaType } from '~/constants/enums'

export type MediaStorageResourceType = 'image' | 'video'
export type UploadableMediaType = MediaType.Image | MediaType.Video | MediaType.Audio

export type DurableMediaAsset = {
  provider: 'cloudinary'
  secure_url: string
  public_id: string
  resource_type: MediaStorageResourceType
}

export type DeleteMediaAssetResult = 'deleted' | 'not_found' | 'failed'

export interface MediaStoragePort {
  upload(filepath: string, mediaType: UploadableMediaType): Promise<DurableMediaAsset>
  delete(publicId: string, resourceType: MediaStorageResourceType): Promise<DeleteMediaAssetResult>
}
