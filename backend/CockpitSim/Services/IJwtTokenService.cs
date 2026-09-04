using CockpitSim.Data;

namespace CockpitSim.Services; // <-- CRITICAL: Tells C# this belongs to CockpitSim.Services

public interface IJwtTokenService
{
    string GenerateToken(ApplicationUser user, string role);
}
