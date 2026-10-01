namespace CockpitSim.DTOs;

// SessionReport payload — THE contract (see AGENTS.md "Telemetry & Grading
// Contract"). One shape, two sources: live (score null, latest values) and
// post-session (aggregates + stored score). Do not change the shape or the
// scenario keys without a team decision — they become stored data.
public class SessionReportDto
{
    public string SessionId { get; set; } = string.Empty;
    public string Scenario { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime StartedAt { get; set; }
    public DateTime? EndedAt { get; set; }
    public double? Score { get; set; }
    public List<ReportMetricDto> Metrics { get; set; } = new();
    public List<string> Warnings { get; set; } = new();
    public List<TimelineEventDto> Timeline { get; set; } = new();
    public List<ReportNoteDto> Notes { get; set; } = new();
}

public class ReportMetricDto
{
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string Unit { get; set; } = string.Empty;
    public double? Actual { get; set; }
    public double? Target { get; set; }
    public double? Tolerance { get; set; }
    public bool? WithinTol { get; set; }
}

public class TimelineEventDto
{
    public string Time { get; set; } = string.Empty;
    public string Event { get; set; } = string.Empty;
}

public class ReportNoteDto
{
    public string Author { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public string Note { get; set; } = string.Empty;
}
