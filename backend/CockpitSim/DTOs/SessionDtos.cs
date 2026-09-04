namespace CockpitSim.DTOs;

public class MeResponseDto
{
    public string UserId { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public DateTime? LastLoginAt { get; set; }
    public string? AssignedTrainerName { get; set; }
}

public class SessionDto
{
    public string SessionId { get; set; } = string.Empty;
    public string Scenario { get; set; } = string.Empty;
    public DateTime StartedAt { get; set; }
    public DateTime? EndedAt { get; set; }
    public string Status { get; set; } = string.Empty;
    public int Attempt { get; set; }
}

public class QueueItemDto
{
    public string SessionId { get; set; } = string.Empty;
    public string TraineeId { get; set; } = string.Empty;
    public string TraineeFullName { get; set; } = string.Empty;
    public string TraineeUsername { get; set; } = string.Empty;
    public string Scenario { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime StartedAt { get; set; }
    public DateTime? EndedAt { get; set; }
}

public class TraineeNoteDto
{
    public string Author { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public string Note { get; set; } = string.Empty;
}

public class FeedbackRequestDto
{
    public string Note { get; set; } = string.Empty;
}
