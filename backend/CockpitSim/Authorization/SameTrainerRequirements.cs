using Microsoft.AspNetCore.Authorization;
using System.Security.Claims;

namespace CockpitSim.Authorization;

// Marker interface
public class SameTrainerRequirement : IAuthorizationRequirement { }

// Simple Trainee Profile Data Model for Context
public class TraineeProfile
{
    public string TraineeUserId { get; set; } = string.Empty;
    public string AssignedTrainerId { get; set; } = string.Empty;
}

// Logic Handler
public class SameTrainerHandler : AuthorizationHandler<SameTrainerRequirement, TraineeProfile>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context, 
        SameTrainerRequirement requirement, 
        TraineeProfile resource)
    {
        var currentUserId = context.User.FindFirstValue(ClaimTypes.NameIdentifier);

        // Allow access if:
        // 1. Current user is an Admin
        // 2. Current user is the assigned Trainer
        // 3. Current user IS the Trainee accessing their own profile
        if (context.User.IsInRole("Admin") || 
            resource.AssignedTrainerId == currentUserId || 
            resource.TraineeUserId == currentUserId)
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}