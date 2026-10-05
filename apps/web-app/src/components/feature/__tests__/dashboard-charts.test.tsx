import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderDashboardCharts } from '../dashboard-charts';
import type { DashboardMetrics } from '@/app/provider/dashboard/dashboard-utils';

/**
 * V-03 guard: the provider dashboard analytics must NOT render the former
 * "Application Flow" line chart — it showed hardcoded mock values
 * ("Simulated mock trends") presented as a 5-day history, a data-integrity
 * risk on a government dashboard. Only the real "Queue Distribution" chart
 * remains, with a zero-data empty-state instead of a blank box.
 */
const metrics = (over: Partial<DashboardMetrics> = {}): DashboardMetrics => ({
  newToday: 0,
  slaBreached: 0,
  awaitingResponse: 0,
  totalQueue: 0,
  ...over,
});

describe('ProviderDashboardCharts (V-03)', () => {
  it('does not render the fabricated "Application Flow" trend chart', () => {
    const html = renderToStaticMarkup(
      <ProviderDashboardCharts metrics={metrics({ newToday: 5, totalQueue: 30 })} />,
    );
    expect(html).not.toContain('Application Flow');
    expect(html).not.toContain('historical trend');
    // the real chart title is still present
    expect(html).toContain('การกระจายคิวงาน');
  });

  it('shows a zero-data empty-state instead of a blank chart box', () => {
    const html = renderToStaticMarkup(<ProviderDashboardCharts metrics={metrics()} />);
    expect(html).toContain('ยังไม่มีข้อมูลในคิว');
  });
});
