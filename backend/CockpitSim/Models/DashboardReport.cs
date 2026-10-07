using System.ComponentModel.DataAnnotations.Schema;

namespace CockpitSim.Models;

// Immutable session-end snapshot. The score is computed ONCE by GradingService
// at session-end and stored in MetricsJson — post-session reads return it
// verbatim, never recomputed. Column mapping matches the MySQL
// dashboard_reports table (database/mysql/cockpitsim_schema.sql) so a future
// MySQL migration set lines up; on SQLite (dev) the table is created by EF
// migrations with the same shape.
[Table("dashboard_reports")]
public class DashboardReport
{
    [Column("id")]
    public string Id { get; set; } = Guid.NewGuid().ToString();

    [Column("session_id")]
    public string SessionId { get; set; } = string.Empty;

    [Column("generated_by")]
    public string? GeneratedBy { get; set; }

    [Column("summary")]
    public string? Summary { get; set; }

    [Column("metrics_json")]
    public string MetricsJson { get; set; } = string.Empty;

    [Column("created_at")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
