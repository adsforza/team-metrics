import { useEffect, useState } from 'react';
import { useFilters } from '../store/filters';
import { api } from '../lib/api';
import type { KPIMetrics, TallaMetric, CFDPoint, ThroughputWeek, AgingIssue } from '../lib/api';

export interface MetricsData {
  kpis: KPIMetrics | null;
  byTalla: TallaMetric[];
  cfd: CFDPoint[];
  throughput: ThroughputWeek[];
  aging: AgingIssue[];
  loading: boolean;
  error: string | null;
}

export function useMetrics(): MetricsData {
  const toQueryParams = useFilters(s => s.toQueryParams);
  const filters = useFilters(s => ({ timeRange: s.timeRange, assignee: s.assignee, talla: s.talla, status: s.status }));

  const [data, setData] = useState<MetricsData>({
    kpis: null, byTalla: [], cfd: [], throughput: [], aging: [], loading: true, error: null,
  });

  useEffect(() => {
    const params = toQueryParams();
    setData(d => ({ ...d, loading: true, error: null }));

    Promise.all([
      api.metrics(params),
      api.metricsByTalla(params),
      api.metricsCFD(params),
      api.metricsThroughput(params),
      api.metricsAging(params),
    ]).then(([kpis, byTalla, cfd, throughput, aging]) => {
      setData({ kpis, byTalla, cfd, throughput, aging, loading: false, error: null });
    }).catch(err => {
      setData(d => ({ ...d, loading: false, error: (err as Error).message }));
    });
  }, [filters.timeRange, filters.assignee, filters.talla, filters.status]);

  return data;
}
