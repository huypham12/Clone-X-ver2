export type MediaProcessingJobData = {
  version: 1
  media_id: string
  // Queue payloads must reference durable storage only; local or absolute paths are never valid here.
  durable_source: {
    provider: 'cloudinary'
    public_id: string
  }
}
