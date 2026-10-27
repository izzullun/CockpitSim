// Presentation-only mappings of API data. Grading remains server-owned.
function dateFromApi(value) {
  if (!value) return null;
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function missionFromHistory(profile, sessions) {
  // TODO: replace on-demand hover with the assigned scenario and briefing when
  // a scheduling endpoint exposes them. There is no assigned session today.
  return {
    scenario: 'hover',
    title: 'Hover practice',
    scheduled: null,
    trainerNote: null,
    timeLimitMinutes: profile?.sessionDurationMinutes ?? null,
    previousFlights: sessions.filter((item) => item.scenario === 'hover').length,
  };
}

export function historyEntries(sessions) {
  return [...sessions].reverse().map((item) => {
    const started = dateFromApi(item.startedAt);
    const ended = dateFromApi(item.endedAt);
    const durationMinutes = started && ended
      ? Math.max(0, Math.round((ended - started) / 60000)) : null;
    const outcome = item.status === 'completed' ? 'Completed'
      : item.status === 'cancelled' ? 'Cancelled'
      : item.status === 'in_progress' ? 'In progress' : 'Scheduled';
    return {
      ...item,
      date: started ? started.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
      durationMinutes,
      outcome,
      canOpenReport: item.status === 'completed' && Boolean(item.sessionId),
    };
  });
}

export function profileStats(sessions) {
  const totalFlightMinutes = sessions.reduce((sum, item) => {
    const started = dateFromApi(item.startedAt);
    const ended = dateFromApi(item.endedAt);
    return sum + (started && ended ? Math.max(0, Math.round((ended - started) / 60000)) : 0);
  }, 0);
  return { sessionsFlown: sessions.length, totalFlightMinutes };
}

export function livePresentation(report) {
  const known = (report.metrics || []).filter((metric) => typeof metric.withinTol === 'boolean');
  if (known.length === 0) return {
    state: 'waiting', message: 'Waiting for the simulator…', showTechnicalDetail: false,
  };
  const breaches = known.filter((metric) => !metric.withinTol).length;
  return breaches > 0
    ? { state: 'check', message: `${breaches} metric${breaches === 1 ? '' : 's'} to check`, showTechnicalDetail: false }
    : { state: 'on-track', message: 'All tracked metrics are within tolerance', showTechnicalDetail: false };
}
