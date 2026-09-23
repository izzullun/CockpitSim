using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using CockpitSim.Data;
using CockpitSim.Services;

var builder = WebApplication.CreateBuilder(args);

// =========================================================
// 1. SERVICES CONFIGURATION
// =========================================================

// Add Web API Controller support (Routes to Controllers/AuthController.cs)
builder.Services.AddControllers();

// Register the database. Provider is environment-driven:
//   Development -> SQLite (local file, zero setup for teammates)
//   Production  -> MySQL via Pomelo (matches database/mysql/cockpitsim_schema.sql)
// Connection strings come from appsettings(.{Environment}).json.
var isDevelopment = builder.Environment.IsDevelopment();
var connectionString = builder.Configuration.GetConnectionString(
    isDevelopment ? "DefaultConnection" : "MySqlConnection");

builder.Services.AddDbContext<ApplicationDbContext>(options =>
{
    if (isDevelopment)
    {
        options.UseSqlite(connectionString);
    }
    else
    {
        options.UseMySql(connectionString, ServerVersion.AutoDetect(connectionString));
    }
});

// Register ASP.NET Core Identity backed by the DbContext.
// IdentityCore (no cookies) — auth is JWT-only via the Bearer scheme below.
// Password rules relaxed so simple demo credentials work in Development.
builder.Services.AddIdentityCore<ApplicationUser>(options =>
    {
        options.Password.RequireDigit = false;
        options.Password.RequireUppercase = false;
        options.Password.RequireLowercase = false;
        options.Password.RequireNonAlphanumeric = false;
        options.Password.RequiredLength = 8;
    })
    .AddRoles<IdentityRole>()
    .AddEntityFrameworkStores<ApplicationDbContext>();

// Add Swagger UI (Interactive API testing in browser)
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Register Custom JWT Token Generator Service
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();

// Enable CORS (Allows your WebView2 HTML/JS dashboard to call this API)
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowLocalhost", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// Configure JWT Bearer Authentication
var jwtKey = builder.Configuration["Jwt:Key"] ?? "CockpitSim_Super_Secret_Key_2026_Must_Be_Long!";
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"] ?? "CockpitSimAPI",
            ValidAudience = builder.Configuration["Jwt:Audience"] ?? "CockpitSimClient",
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
        };
    });

// Register Authorization Policies
builder.Services.AddAuthorizationBuilder()
    .AddPolicy("RequireTrainer", policy => policy.RequireRole("trainer"))
    .AddPolicy("RequireTrainee", policy => policy.RequireRole("trainee"))
    .AddPolicy("RequireStaff", policy => policy.RequireRole("trainer", "admin"));

// =========================================================
// 2. MIDDLEWARE PIPELINE
// =========================================================

var app = builder.Build();

// Enable Swagger UI in Development mode (visit http://localhost:<port>/swagger)
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// HTTPS redirect only outside Development — the local dashboard (Live Server,
// plain HTTP) calls the HTTP port directly during development.
if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

// Enable CORS
app.UseCors("AllowLocalhost");

// Enable Authentication & Authorization (MUST come before app.MapControllers)
var dashboardPath = Path.GetFullPath(
      Path.Combine(builder.Environment.ContentRootPath, "..",
      "..", "dashboard"));

  app.UseStaticFiles(new StaticFileOptions
  {
      FileProvider = new PhysicalFileProvider(dashboardPath),
      RequestPath = "/dashboard"
  });
  
app.UseAuthentication();
app.UseAuthorization();

// Provision the schema, then seed. The checked-in EF migrations are
// SQLite-flavored (TEXT/INTEGER, Sqlite:Autoincrement), so only auto-apply
// them on SQLite (Development). On MySQL we must NOT run them through Pomelo
// — that would fail at startup. Instead, the MySQL schema is provisioned
// separately (apply database/mysql/cockpitsim_schema.sql, or generate a
// MySQL migration set) BEFORE launching in Production; here we only verify
// the database is reachable.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>()
        .CreateLogger("Startup");

    if (db.Database.IsSqlite())
    {
        // Self-provision the local dev file and apply pending migrations.
        await db.Database.MigrateAsync();
    }
    else if (db.Database.IsMySql())
    {
        if (await db.Database.CanConnectAsync())
        {
            logger.LogInformation(
                "MySQL reachable. EF migrations are skipped on MySQL — " +
                "schema must be provisioned separately (see AGENTS.md).");
        }
        else
        {
            logger.LogWarning(
                "MySQL is configured but not reachable at startup. " +
                "Provision the schema (database/mysql/cockpitsim_schema.sql) " +
                "and ensure the server is running before relying on the API.");
        }
    }

    // Seed roles (lowercase, matching authorization policies) and the demo
    // user roster. Both are idempotent — safe to run on every startup.
    await DbInitializer.SeedRolesAsync(scope.ServiceProvider);
    if (app.Environment.IsDevelopment())
    {
        await DbInitializer.SeedUsersAsync(scope.ServiceProvider);
        await DbInitializer.SeedSessionsAsync(scope.ServiceProvider);
    }
}

// Unauthenticated liveness probe — used by the WPF launcher to check the
// backend is up before navigating, and by the Windows Service install later.
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

// Map REST API Controllers
app.MapControllers();

app.Run();