import { MediaType } from '~/constants/enums'
import {
  deleteFromCloudinary,
  uploadAudioToCloudinary,
  uploadImageToCloudinary,
  uploadVideoToCloudinary
} from '~/utils/cloudinary'
import { DeleteMediaAssetResult, DurableMediaAsset, MediaStoragePort, UploadableMediaType } from './media-storage.port'

export class CloudinaryMediaStorage implements MediaStoragePort {
  async upload(filepath: string, mediaType: UploadableMediaType): Promise<DurableMediaAsset> {
    const uploadResult =
      mediaType === MediaType.Image
        ? await uploadImageToCloudinary(filepath)
        : mediaType === MediaType.Video
          ? await uploadVideoToCloudinary(filepath)
          : await uploadAudioToCloudinary(filepath)

    return {
      provider: 'cloudinary',
      secure_url: uploadResult.secure_url,
      public_id: uploadResult.public_id,
      resource_type: mediaType === MediaType.Image ? 'image' : 'video'
    }
  }

  async delete(publicId: string, resourceType: 'image' | 'video'): Promise<DeleteMediaAssetResult> {
    try {
      const result = await deleteFromCloudinary(publicId, resourceType)
      if (result.result === 'ok') return 'deleted'
      if (result.result === 'not found') return 'not_found'
      return 'failed'
    } catch {
      return 'failed'
    }
  }
}
