export interface StoredProviderStatus {
  eventTime: number;
  statusRank: number;
}

export function shouldApplyProviderStatus(
  stored: StoredProviderStatus | null,
  incoming: StoredProviderStatus,
): boolean {
  return (
    stored === null ||
    incoming.eventTime > stored.eventTime ||
    (incoming.eventTime === stored.eventTime &&
      incoming.statusRank >= stored.statusRank)
  );
}
