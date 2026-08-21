-- =========================================================
-- CockpitSim MySQL Schema
-- Based on: ASP.NET Core Identity + JWT auth (no cookies)
-- Roles: trainee, trainer, admin
-- =========================================================

CREATE DATABASE IF NOT EXISTS cockpitsim
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE cockpitsim;

-- =========================================================
-- 1. ASP.NET CORE IDENTITY TABLES
-- These match the default schema EF Core Identity generates
-- for Pomelo.EntityFrameworkCore.MySql, so if you later run
-- `dotnet ef migrations add InitialCreate` the model should
-- line up with this hand-written version (or you can just
-- let EF generate migrations instead of running this file).
-- =========================================================

-- ---------------------------------------------------------
-- AspNetRoles
-- ---------------------------------------------------------
CREATE TABLE AspNetRoles (
    Id               VARCHAR(255) NOT NULL,
    Name             VARCHAR(256) NULL,
    NormalizedName   VARCHAR(256) NULL,
    ConcurrencyStamp VARCHAR(255) NULL,
    PRIMARY KEY (Id),
    UNIQUE KEY RoleNameIndex (NormalizedName)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- AspNetUsers  (extended with CockpitSim-specific columns)
-- ---------------------------------------------------------
CREATE TABLE AspNetUsers (
    Id                     VARCHAR(255) NOT NULL,
    UserName               VARCHAR(256) NULL,
    NormalizedUserName     VARCHAR(256) NULL,
    Email                  VARCHAR(256) NULL,
    NormalizedEmail        VARCHAR(256) NULL,
    EmailConfirmed         TINYINT(1) NOT NULL DEFAULT 0,
    PasswordHash           LONGTEXT NULL,
    SecurityStamp          LONGTEXT NULL,
    ConcurrencyStamp       LONGTEXT NULL,
    PhoneNumber            LONGTEXT NULL,
    PhoneNumberConfirmed   TINYINT(1) NOT NULL DEFAULT 0,
    TwoFactorEnabled       TINYINT(1) NOT NULL DEFAULT 0,
    LockoutEnd             DATETIME(6) NULL,
    LockoutEnabled         TINYINT(1) NOT NULL DEFAULT 0,
    AccessFailedCount      INT NOT NULL DEFAULT 0,

    -- ---- CockpitSim-specific fields (from the chat) ----
    FullName               VARCHAR(200) NOT NULL,
    AssignedTrainerId      VARCHAR(255) NULL,       -- null for trainer/admin
    CreatedAt              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    LastLoginAt            DATETIME(6) NULL,

    PRIMARY KEY (Id),
    UNIQUE KEY UserNameIndex (NormalizedUserName),
    KEY EmailIndex (NormalizedEmail),
    KEY IX_AspNetUsers_AssignedTrainerId (AssignedTrainerId),
    CONSTRAINT FK_AspNetUsers_AspNetUsers_AssignedTrainerId
        FOREIGN KEY (AssignedTrainerId) REFERENCES AspNetUsers (Id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- AspNetUserRoles
-- ---------------------------------------------------------
CREATE TABLE AspNetUserRoles (
    UserId VARCHAR(255) NOT NULL,
    RoleId VARCHAR(255) NOT NULL,
    PRIMARY KEY (UserId, RoleId),
    KEY IX_AspNetUserRoles_RoleId (RoleId),
    CONSTRAINT FK_AspNetUserRoles_AspNetRoles_RoleId
        FOREIGN KEY (RoleId) REFERENCES AspNetRoles (Id) ON DELETE CASCADE,
    CONSTRAINT FK_AspNetUserRoles_AspNetUsers_UserId
        FOREIGN KEY (UserId) REFERENCES AspNetUsers (Id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- AspNetUserClaims
-- ---------------------------------------------------------
CREATE TABLE AspNetUserClaims (
    Id         INT NOT NULL AUTO_INCREMENT,
    UserId     VARCHAR(255) NOT NULL,
    ClaimType  LONGTEXT NULL,
    ClaimValue LONGTEXT NULL,
    PRIMARY KEY (Id),
    KEY IX_AspNetUserClaims_UserId (UserId),
    CONSTRAINT FK_AspNetUserClaims_AspNetUsers_UserId
        FOREIGN KEY (UserId) REFERENCES AspNetUsers (Id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- AspNetRoleClaims
-- ---------------------------------------------------------
CREATE TABLE AspNetRoleClaims (
    Id         INT NOT NULL AUTO_INCREMENT,
    RoleId     VARCHAR(255) NOT NULL,
    ClaimType  LONGTEXT NULL,
    ClaimValue LONGTEXT NULL,
    PRIMARY KEY (Id),
    KEY IX_AspNetRoleClaims_RoleId (RoleId),
    CONSTRAINT FK_AspNetRoleClaims_AspNetRoles_RoleId
        FOREIGN KEY (RoleId) REFERENCES AspNetRoles (Id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- AspNetUserLogins
-- ---------------------------------------------------------
CREATE TABLE AspNetUserLogins (
    LoginProvider       VARCHAR(255) NOT NULL,
    ProviderKey          VARCHAR(255) NOT NULL,
    ProviderDisplayName  LONGTEXT NULL,
    UserId               VARCHAR(255) NOT NULL,
    PRIMARY KEY (LoginProvider, ProviderKey),
    KEY IX_AspNetUserLogins_UserId (UserId),
    CONSTRAINT FK_AspNetUserLogins_AspNetUsers_UserId
        FOREIGN KEY (UserId) REFERENCES AspNetUsers (Id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- AspNetUserTokens
-- ---------------------------------------------------------
CREATE TABLE AspNetUserTokens (
    UserId        VARCHAR(255) NOT NULL,
    LoginProvider VARCHAR(255) NOT NULL,
    Name          VARCHAR(255) NOT NULL,
    Value         LONGTEXT NULL,
    PRIMARY KEY (UserId, LoginProvider, Name),
    CONSTRAINT FK_AspNetUserTokens_AspNetUsers_UserId
        FOREIGN KEY (UserId) REFERENCES AspNetUsers (Id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================================================
-- 2. COCKPITSIM DOMAIN TABLES
-- (matching the /api/v1 resources discussed in the chat)
-- =========================================================

-- ---------------------------------------------------------
-- sessions  — training sessions run by a trainee (and
-- optionally observed/assigned by a trainer)
-- ---------------------------------------------------------
CREATE TABLE sessions (
    id           CHAR(36) NOT NULL,                 -- GUID, matches AspNetUsers.Id style
    trainee_id   VARCHAR(255) NOT NULL,
    trainer_id   VARCHAR(255) NULL,
    scenario     VARCHAR(200) NULL,
    started_at   DATETIME(6) NOT NULL,
    ended_at     DATETIME(6) NULL,
    status       ENUM('scheduled', 'in_progress', 'completed', 'cancelled')
                     NOT NULL DEFAULT 'scheduled',
    created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY IX_sessions_trainee_id (trainee_id),
    KEY IX_sessions_trainer_id (trainer_id),
    CONSTRAINT FK_sessions_AspNetUsers_trainee_id
        FOREIGN KEY (trainee_id) REFERENCES AspNetUsers (Id) ON DELETE CASCADE,
    CONSTRAINT FK_sessions_AspNetUsers_trainer_id
        FOREIGN KEY (trainer_id) REFERENCES AspNetUsers (Id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- dashboard_reports  — reports generated per session
-- ---------------------------------------------------------
CREATE TABLE dashboard_reports (
    id           CHAR(36) NOT NULL,
    session_id   CHAR(36) NOT NULL,
    generated_by VARCHAR(255) NULL,                 -- user who generated it
    summary      TEXT NULL,
    metrics_json JSON NULL,                         -- flexible metric payload
    created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY IX_dashboard_reports_session_id (session_id),
    CONSTRAINT FK_dashboard_reports_sessions_session_id
        FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
    CONSTRAINT FK_dashboard_reports_AspNetUsers_generated_by
        FOREIGN KEY (generated_by) REFERENCES AspNetUsers (Id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- ids_logs — intrusion detection system logs tied to a session
-- ---------------------------------------------------------
CREATE TABLE ids_logs (
    id           BIGINT NOT NULL AUTO_INCREMENT,
    session_id   CHAR(36) NULL,
    severity     ENUM('info', 'low', 'medium', 'high', 'critical')
                     NOT NULL DEFAULT 'info',
    source       VARCHAR(200) NULL,
    message      TEXT NOT NULL,
    logged_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY IX_ids_logs_session_id (session_id),
    CONSTRAINT FK_ids_logs_sessions_session_id
        FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================================================
-- 3. SEED DATA — roles
-- =========================================================
INSERT INTO AspNetRoles (Id, Name, NormalizedName, ConcurrencyStamp) VALUES
    (UUID(), 'trainee', 'TRAINEE', UUID()),
    (UUID(), 'trainer', 'TRAINER', UUID()),
    (UUID(), 'admin',   'ADMIN',   UUID());

-- =========================================================
-- 4. SEED DATA — demo users
-- =========================================================
-- NOTE: PasswordHash values below are PLACEHOLDERS. ASP.NET Core
-- Identity's PasswordHash is not plain BCrypt — it's a specific
-- format produced by PasswordHasher<TUser> (PBKDF2 by default).
-- Do NOT insert real login credentials directly via SQL; instead,
-- seed these users through your app startup using UserManager,
-- e.g.:
--
--   await _userManager.CreateAsync(user, "TempPassword123!");
--   await _userManager.AddToRoleAsync(user, "trainer");
--
-- The rows below just illustrate row shape / relationships so
-- you can see how AssignedTrainerId links trainees to trainers.
-- Replace 'REPLACE_WITH_IDENTITY_HASH' via the app, not by hand.

SET @trainerLimId  = UUID();
SET @traineeAdamId = UUID();
SET @traineeSitiId = UUID();
SET @adminDemoId   = UUID();

INSERT INTO AspNetUsers
    (Id, UserName, NormalizedUserName, Email, NormalizedEmail,
     EmailConfirmed, PasswordHash, SecurityStamp, ConcurrencyStamp,
     PhoneNumberConfirmed, TwoFactorEnabled, LockoutEnabled, AccessFailedCount,
     FullName, AssignedTrainerId, CreatedAt)
VALUES
    (@trainerLimId, 'trainer_lim', 'TRAINER_LIM',
     'trainer_lim@cockpitsim.local', 'TRAINER_LIM@COCKPITSIM.LOCAL',
     1, 'REPLACE_WITH_IDENTITY_HASH', UUID(), UUID(),
     0, 0, 0, 0,
     'Lim (Trainer)', NULL, NOW(6)),

    (@traineeAdamId, 'trainee_adam', 'TRAINEE_ADAM',
     'trainee_adam@cockpitsim.local', 'TRAINEE_ADAM@COCKPITSIM.LOCAL',
     1, 'REPLACE_WITH_IDENTITY_HASH', UUID(), UUID(),
     0, 0, 0, 0,
     'Adam (Trainee)', @trainerLimId, NOW(6)),

    (@traineeSitiId, 'trainee_siti', 'TRAINEE_SITI',
     'trainee_siti@cockpitsim.local', 'TRAINEE_SITI@COCKPITSIM.LOCAL',
     1, 'REPLACE_WITH_IDENTITY_HASH', UUID(), UUID(),
     0, 0, 0, 0,
     'Siti (Trainee)', @trainerLimId, NOW(6)),

    (@adminDemoId, 'admin_demo', 'ADMIN_DEMO',
     'admin_demo@cockpitsim.local', 'ADMIN_DEMO@COCKPITSIM.LOCAL',
     1, 'REPLACE_WITH_IDENTITY_HASH', UUID(), UUID(),
     0, 0, 0, 0,
     'Demo Admin', NULL, NOW(6));

-- Assign roles to the seeded users
INSERT INTO AspNetUserRoles (UserId, RoleId)
SELECT @trainerLimId, Id FROM AspNetRoles WHERE NormalizedName = 'TRAINER';

INSERT INTO AspNetUserRoles (UserId, RoleId)
SELECT @traineeAdamId, Id FROM AspNetRoles WHERE NormalizedName = 'TRAINEE';

INSERT INTO AspNetUserRoles (UserId, RoleId)
SELECT @traineeSitiId, Id FROM AspNetRoles WHERE NormalizedName = 'TRAINEE';

INSERT INTO AspNetUserRoles (UserId, RoleId)
SELECT @adminDemoId, Id FROM AspNetRoles WHERE NormalizedName = 'ADMIN';

-- =========================================================
-- Done.
-- =========================================================
