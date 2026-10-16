using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CockpitSim.Migrations
{
    /// <inheritdoc />
    public partial class AddSessionTimeLimits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "TimeLimitMinutes",
                table: "Sessions",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SessionDurationMinutes",
                table: "AspNetUsers",
                type: "INTEGER",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TimeLimitMinutes",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "SessionDurationMinutes",
                table: "AspNetUsers");
        }
    }
}
