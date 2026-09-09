export const HOME_COLLECTION_STATUSES = [
  "Requested",
  "Contacted",
  "Completed",
  "Cancelled"
] as const;

export type HomeCollectionStatus = (typeof HOME_COLLECTION_STATUSES)[number];