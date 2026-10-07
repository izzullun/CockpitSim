using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CockpitSim.Migrations
{
    /// <inheritdoc />
    public partial class AddDashboardReports : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "dashboard_reports",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    session_id = table.Column<string>(type: "TEXT", nullable: false),
                    generated_by = table.Column<string>(type: "TEXT", nullable: true),
                    summary = table.Column<string>(type: "TEXT", nullable: true),
                    metrics_json = table.Column<string>(type: "TEXT", nullable: false),
                    created_at = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_dashboard_reports", x => x.id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "dashboard_reports");
        }
    }
}
