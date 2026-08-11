using CockpitSim.Models;

namespace CockpitSim.Services; // <-- CRITICAL: Tells C# this belongs to CockpitSim.Services

public interface IJwtTokenService
{
    string GenerateToken(User user);
}