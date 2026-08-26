using Microsoft.AspNetCore.Identity;

namespace CockpitSim.Data;

public static class DbInitializer
{
    // Roles must stay lowercase to match the authorization policies
    // registered in Program.cs ("RequireTrainer" etc. require "trainer").
    private static readonly string[] RoleNames = { "trainee", "trainer", "admin" };

    public static async Task SeedRolesAsync(IServiceProvider serviceProvider)
    {
        var roleManager = serviceProvider.GetRequiredService<RoleManager<IdentityRole>>();

        foreach (var roleName in RoleNames)
        {
            if (!await roleManager.RoleExistsAsync(roleName))
            {
                await roleManager.CreateAsync(new IdentityRole(roleName));
            }
        }
    }

    private sealed record SeedUser(
        string Username, string Password, string FullName, string Role, string? AssignedTrainerUsername);

    // Demo roster supplied by Adam (2026-08-26). Passwords are hashed by
    // Identity (PBKDF2) at seed time — never stored or inserted as plaintext.
    private static readonly SeedUser[] Users =
    {
        new("trainer_azlan",  "Azlan123!",  "Azlan Ahmad",   "trainer", null),
        new("trainer_hakim",  "Hakim123!",  "Hakim Zainal",  "trainer", null),
        new("trainee_adam",   "Adam123!",   "Adam Haikal",   "trainee", "trainer_azlan"),
        new("trainee_faris",  "Faris123!",  "Faris Aiman",   "trainee", "trainer_azlan"),
        new("trainee_syafiq", "Syafiq123!", "Syafiq Razak",  "trainee", "trainer_hakim"),
        new("trainee_danish", "Danish123!", "Danish Ismail", "trainee", "trainer_hakim"),
    };

    public static async Task SeedUsersAsync(IServiceProvider serviceProvider)
    {
        var userManager = serviceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var logger = serviceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("DbInitializer");

        foreach (var spec in Users)
        {
            // Idempotent: skip users that already exist so restarts are safe.
            if (await userManager.FindByNameAsync(spec.Username) != null)
            {
                continue;
            }

            string? trainerId = null;
            if (spec.AssignedTrainerUsername != null)
            {
                var trainer = await userManager.FindByNameAsync(spec.AssignedTrainerUsername);
                if (trainer == null)
                {
                    logger.LogWarning(
                        "Seed skipped AssignedTrainer link for {Username}: trainer {Trainer} not found",
                        spec.Username, spec.AssignedTrainerUsername);
                }
                else
                {
                    trainerId = trainer.Id;
                }
            }

            var user = new ApplicationUser
            {
                UserName = spec.Username,
                FullName = spec.FullName,
                AssignedTrainerId = trainerId,
                EmailConfirmed = true
            };

            var result = await userManager.CreateAsync(user, spec.Password);
            if (!result.Succeeded)
            {
                foreach (var error in result.Errors)
                {
                    logger.LogError("Seed failed for {Username}: {Code} {Description}",
                        spec.Username, error.Code, error.Description);
                }

                continue;
            }

            await userManager.AddToRoleAsync(user, spec.Role);
            logger.LogInformation("Seeded user {Username} ({Role})", spec.Username, spec.Role);
        }
    }

    // Demo session history so the dashboards have data to render on first run.
    // Idempotent: only seeds when the Sessions table is empty.
    public static async Task SeedSessionsAsync(IServiceProvider serviceProvider)
    {
        var userManager = serviceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var db = serviceProvider.GetRequiredService<ApplicationDbContext>();
        var logger = serviceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("DbInitializer");

        if (db.Sessions.Any())
        {
            return;
        }

        var scenarios = new[]
        {
            "Autorotation Recovery", "Hover Hold", "Emergency Landing",
            "Nap-of-the-Earth Flight", "Confined Area Landing"
        };

        string? TraineeId(string username) => userManager.FindByNameAsync(username).GetAwaiter().GetResult()?.Id;
        string? TrainerId(string username) => userManager.FindByNameAsync(username).GetAwaiter().GetResult()?.Id;

        var azlanId = TrainerId("trainer_azlan");
        var hakimId = TrainerId("trainer_hakim");

        // (trainee, trainer, scenario index, days ago, duration minutes, status)
        var plan = new (string Trainee, string? Trainer, int ScenarioIdx, int DaysAgo, int Minutes, string Status)[]
        {
            ("trainee_adam",   azlanId, 0, 21, 17, "completed"),
            ("trainee_adam",   azlanId, 0, 14, 19, "completed"),
            ("trainee_adam",   azlanId, 0, 7,  22, "completed"),
            ("trainee_faris",  azlanId, 1, 18, 15, "completed"),
            ("trainee_faris",  azlanId, 1, 11, 16, "cancelled"),
            ("trainee_syafiq", hakimId, 2, 20, 21, "completed"),
            ("trainee_syafiq", hakimId, 3, 9,  24, "completed"),
            ("trainee_danish", hakimId, 4, 16, 18, "completed"),
            ("trainee_danish", hakimId, 4, 6,  20, "completed"),
        };

        var now = DateTime.UtcNow;
        var notesBySessionKey = new Dictionary<string, string[]>
        {
            ["trainee_adam|0"] = new[] { "Collective input was late on entry." },
            ["trainee_adam|2"] = new[] { "Good flare timing this attempt.", "Ready for the next exercise." },
            ["trainee_syafiq|0"] = new[] { "Stable descent, watch the heading drift." },
            ["trainee_danish|1"] = new[] { "Solid improvement on approach speed." },
        };

        var counters = Users.Where(u => u.Role == "trainee")
                            .ToDictionary(u => u.Username, _ => 0);

        foreach (var row in plan)
        {
            var traineeId = TraineeId(row.Trainee);
            if (traineeId == null)
            {
                logger.LogWarning("Seed sessions skipped for {Trainee}: user not found", row.Trainee);
                continue;
            }

            counters[row.Trainee]++;
            var startedAt = now.AddDays(-row.DaysAgo).AddHours(-2);

            var session = new Models.TrainingSession
            {
                TraineeId = traineeId,
                TrainerId = row.Trainer,
                Scenario = $"{scenarios[row.ScenarioIdx]} — Attempt {counters[row.Trainee]}",
                StartedAt = startedAt,
                EndedAt = row.Status == "scheduled" ? null : startedAt.AddMinutes(row.Minutes),
                Status = row.Status
            };
            db.Sessions.Add(session);
            await db.SaveChangesAsync();

            if (notesBySessionKey.TryGetValue($"{row.Trainee}|{counters[row.Trainee] - 1}", out var noteTexts) && row.Trainer != null)
            {
                foreach (var text in noteTexts)
                {
                    db.SessionNotes.Add(new Models.SessionNote
                    {
                        SessionId = session.Id,
                        AuthorId = row.Trainer,
                        Note = text,
                        CreatedAt = session.EndedAt ?? startedAt
                    });
                }
                await db.SaveChangesAsync();
            }
        }

        logger.LogInformation("Seeded {Count} demo training sessions", plan.Length);
    }
}
