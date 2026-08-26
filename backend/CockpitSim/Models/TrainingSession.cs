namespace CockpitSim.Models;

// A training session run by a trainee. Status values match the MySQL
// schema in database/mysql/cockpitsim_schema.sql:
// scheduled | in_progress | completed | cancelled
public class TrainingSession
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string TraineeId { get; set; } = string.Empty;
    public string? TrainerId { get; set; }
    public string? Scenario { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime? EndedAt { get; set; }
    public string Status { get; set; } = "scheduled";
}

// Trainer feedback attached to a session.
public class SessionNote
{
    public int Id { get; set; }
    public string SessionId { get; set; } = string.Empty;
    public string AuthorId { get; set; } = string.Empty;
    public string Note { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
