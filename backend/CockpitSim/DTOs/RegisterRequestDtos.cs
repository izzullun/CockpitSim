namespace CockpitSim.DTOs;

// SPIKE (throwaway): trainer self-registration.
public class RegisterTrainerRequestDto
{
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string? RegistrationCode { get; set; }
}

// SPIKE (throwaway): trainer creates a trainee account.
// AssignedTrainerId is NEVER taken from the body — it comes from the JWT.
public class CreateTraineeRequestDto
{
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}
