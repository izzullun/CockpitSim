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

// Register the database (SQLite for now — swap to Pomelo MySQL later;
// only this registration and the connection string change).
builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("DefaultConnection")));

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

// TODO (Member 3): swap to Pomelo MySQL for production:
// options.UseMySql(connectionString, ServerVersion.AutoDetect(connectionString))



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

// Seed roles (lowercase, matching authorization policies) and the demo
// user roster. Both are idempotent — safe to run on every startup.
using (var scope = app.Services.CreateScope())
{
    await DbInitializer.SeedRolesAsync(scope.ServiceProvider);
    if (app.Environment.IsDevelopment())
    {
        await DbInitializer.SeedUsersAsync(scope.ServiceProvider);
        await DbInitializer.SeedSessionsAsync(scope.ServiceProvider);
    }
}

// Map REST API Controllers
app.MapControllers();

app.Run();