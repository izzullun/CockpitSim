import { dateFromApi } from './trainee-view-model.js';

// Stored report presentation. This module never calculates a score or risk.
export function resultView(report) {
  const score = typeof report?.score === 'number' ? report.score : null;
  const metrics = Array.isArray(report?.metrics) ? report.metrics : [];
  const warnings = Array.isArray(report?.warnings) ? report.warnings : [];
  const noTelemetry = warnings.some((warning) => /no telemetry was captured/i.test(warning));
  if (noTelemetry) return { state: 'no-data', score: null, stars: 0, flightMinutes: flightMinutes(report) };
  if (score === null) return { state: 'pending', score: null, stars: 0, flightMinutes: flightMinutes(report) };
  if (!metrics.some((metric) => metric.actual !== null && metric.actual !== undefined)) {
    return { state: 'no-data', score: null, stars: 0, flightMinutes: flightMinutes(report) };
  }
  const threshold = typeof report.passThreshold === 'number' ? report.passThreshold : 70;
  return {
    state: score >= threshold ? 'complete' : 'needs-work',
    score,
    stars: score >= 90 ? 3 : score >= 70 ? 2 : 1,
    threshold,
    flightMinutes: flightMinutes(report),
  };
}

function flightMinutes(report) {
  if (!report?.startedAt || !report?.endedAt) return null;
  const from = dateFromApi(report.startedAt)?.getTime() ?? NaN;
  const to = dateFromApi(report.endedAt)?.getTime() ?? NaN;
  return Number.isFinite(from) && Number.isFinite(to) ? Math.max(0, Math.round((to - from) / 60000)) : null;
}

export function previousSession(sessions, currentReport) {
  const currentAt = dateFromApi(currentReport.startedAt)?.getTime() ?? NaN;
  return [...sessions]
    .filter((item) => item.sessionId !== currentReport.sessionId
      && item.scenario === currentReport.scenario
      && item.status === 'completed'
      && (dateFromApi(item.startedAt)?.getTime() ?? NaN) < currentAt)
    .sort((a, b) => dateFromApi(b.startedAt) - dateFromApi(a.startedAt))[0] || null;
}

export function metricInsights(_scenario, metrics) {
  const graded = (metrics || [])
    .filter((metric) => typeof metric.withinPct === 'number')
    .sort((a, b) => a.withinPct - b.withinPct);
  return { strongest: graded.at(-1) || null, focus: graded.length > 1 ? graded[0] : null };
}

export function breakdownRows(metrics) {
  return (metrics || []).filter((metric) => metric.weight !== null && metric.weight !== undefined)
    .map((metric) => ({
      label: metric.label,
      weight: String(metric.weight),
      within: typeof metric.withinPct === 'number' ? `${metric.withinPct.toFixed(1)}%` : '—',
      contribution: typeof metric.contribution === 'number' ? metric.contribution.toFixed(1) : '—',
    }));
}
