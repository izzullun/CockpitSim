using System.Text.Json;
using CockpitSim.DTOs;

namespace CockpitSim.Services;

internal static class StoredFlightScore
{
    public static double? Read(string? snapshot)
    {
        if (snapshot is null) return null;

        try
        {
            var report = JsonSerializer.Deserialize<SessionReportDto>(snapshot, GradingService.JsonOptions);
            return report?.Score;
        }
        catch (JsonException)
        {
            // Keep older or unreadable reports from breaking the session list.
            return null;
        }
    }
}
