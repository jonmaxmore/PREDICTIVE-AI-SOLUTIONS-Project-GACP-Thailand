/**
 * Provider SAP-Fiori launchpad components (B1).
 *
 * Reusable, presentational building blocks for the provider (staff)
 * launchpad dashboards. Token-only, no data fetching. The generic
 * `/provider/dashboard` is the canonical launchpad; the other role
 * dashboards copy these.
 */
export { KpiTile } from './kpi-tile';
export type { KpiTileProps, KpiTileTone } from './kpi-tile';
export { KpiTileGrid } from './kpi-tile-grid';
export type { KpiTileGridProps } from './kpi-tile-grid';
export { LaunchpadHeader } from './launchpad-header';
export type { LaunchpadHeaderProps } from './launchpad-header';
export { QueueSection } from './queue-section';
export type { QueueSectionProps } from './queue-section';
