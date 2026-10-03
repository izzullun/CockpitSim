using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using CockpitSim.Models;

namespace CockpitSim.Data;

public class ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : IdentityDbContext<ApplicationUser>(options)
{
    public DbSet<TrainingSession> Sessions => Set<TrainingSession>();
    public DbSet<SessionNote> SessionNotes => Set<SessionNote>();
    public DbSet<DashboardReport> Reports => Set<DashboardReport>();
}
