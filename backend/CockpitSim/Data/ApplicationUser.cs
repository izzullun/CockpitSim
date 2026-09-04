using Microsoft.AspNetCore.Identity;

namespace CockpitSim.Data;

// Add profile data for application users by adding properties to the ApplicationUser class
public class ApplicationUser : IdentityUser
{
    public string FullName { get; set; } = string.Empty;

    // Trainees only — Id of the trainer user this trainee is assigned to.
    public string? AssignedTrainerId { get; set; }

    public DateTime? LastLoginAt { get; set; }
}

