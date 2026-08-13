import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// Singleton registry. Next's module cache keeps this alive across requests in
// the Node runtime; dev HMR can double-register, which prom-client tolerates
// via the `register.registerMetric` guard (we catch the throw).
export const registry = new Registry();
registry.setDefaultLabels({ app: 'gapfinder' });
collectDefaultMetrics({ register: registry });

function safeRegister<T>(factory: () => T): T {
  try {
    return factory();
  } catch (err) {
    // HMR double-registration — fall back to looking up the existing metric.
    const msg = (err as Error).message;
    throw new Error(`prom-client registration failed: ${msg}`);
  }
}

export const ingestionJobDuration = safeRegister(
  () =>
    new Histogram({
      name: 'sfm_ingestion_job_duration_seconds',
      help: 'Duration of ingestion jobs',
      labelNames: ['job_type', 'status'] as const,
      buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600],
      registers: [registry],
    }),
);

export const classificationLatency = safeRegister(
  () =>
    new Histogram({
      name: 'sfm_classification_latency_seconds',
      help: 'End-to-end classification pipeline latency',
      labelNames: ['status'] as const,
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
      registers: [registry],
    }),
);

export const shopifyRequestCount = safeRegister(
  () =>
    new Counter({
      name: 'sfm_shopify_requests_total',
      help: 'Shopify API request count',
      labelNames: ['op', 'outcome'] as const,
      registers: [registry],
    }),
);

export const activeStores = safeRegister(
  () =>
    new Gauge({
      name: 'sfm_active_stores',
      help: 'Number of installed, non-uninstalled stores',
      registers: [registry],
    }),
);

export const revenueSurfaced = safeRegister(
  () =>
    new Gauge({
      name: 'sfm_revenue_surfaced_cents',
      help: 'Sum of revenue estimates across all stores (cents)',
      registers: [registry],
    }),
);

export const httpRequestsTotal = safeRegister(
  () =>
    new Counter({
      name: 'sfm_http_requests_total',
      help: 'HTTP request count',
      labelNames: ['route', 'method', 'status'] as const,
      registers: [registry],
    }),
);
