<?php

namespace App\Http\Controllers;

use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Http\Request;

class DashboradController extends Controller
{
    public function index()
    {
        if (Auth::user()->role !== 'admin') {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $projects = Project::query()
            ->withCount(['rooms', 'devices', 'connections'])
            ->latest()
            ->get();
        $totalUsers = User::count();
        $activeSubscriptions = User::query()
            ->whereNotNull('subscription_expires_at')
            ->where('subscription_expires_at', '>', now())
            ->count();

        return response()->json([
            'statistics' => [
                'total_users' => $totalUsers,
                'total_projects' => $projects->count(),
                'subscribed_accounts' => $activeSubscriptions,
                'free_accounts' => $totalUsers - $activeSubscriptions,
            ],
            'recent_projects' => $projects->take(5)->values()->map(function (Project $project) {
                return [
                    'id' => $project->id,
                    'name' => $project->name,
                    'type' => $project->type,
                    'status' => $project->status,
                    'thumbnail' => $project->thumbnail,
                    'rooms' => $project->rooms_count,
                    'devices' => $project->devices_count,
                  //  'connections' => $project->connections_count,
                    'created_at' => $project->created_at,
                    'updated_at' => $project->updated_at,
                ];
            }),
        ]);
    }

    public function subscriptionStatus()
    {
        $user = Auth::user();

        return response()->json([
            'plan' => $user->subscription_plan,
            'active' => $user->hasActiveSubscription(),
            'started_at' => $user->subscription_started_at,
            'expires_at' => $user->subscription_expires_at,
            'free_project_limit' => 5,
            'projects_count' => Project::where('user_id', $user->id)->count(),
        ]);
    }

    public function users()
    {
        if (Auth::user()->role !== 'admin') {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $users = User::query()
            ->withCount([
                'projects',
                'projects as completed_projects_count' => function ($query) {
                    $query->where('status', 'completed');
                },
            ])
            ->latest()
            ->get(['id', 'name', 'email', 'role', 'subscription_plan', 'subscription_started_at', 'subscription_expires_at', 'created_at']);

        return response()->json([
            'users' => $users->map(function (User $user) {
                return [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'role' => $user->role,
                    'projects_count' => $user->projects_count,
                    'completed_projects_count' => $user->completed_projects_count,
                    'subscription' => [
                        'plan' => $user->subscription_plan,
                        'active' => $user->hasActiveSubscription(),
                        'started_at' => $user->subscription_started_at,
                        'expires_at' => $user->subscription_expires_at,
                    ],
                    'created_at' => $user->created_at,
                ];
            })->values(),
        ]);
    }

    public function deleteUser(User $user)
    {
        if (Auth::user()->role !== 'admin') {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $user->tokens()->delete();
        $user->delete();

        return response()->json(['message' => 'User account deleted successfully']);
    }

    public function userProjects(User $user)
    {
        if (Auth::user()->role !== 'admin') {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        return response()->json([
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
            ],
            'projects' => Project::where('user_id', $user->id)
                ->withCount(['rooms', 'devices', 'connections'])
                ->latest()
                ->get(['id', 'name', 'type', 'status', 'thumbnail', 'created_at', 'updated_at'])
                ->map(function (Project $project) {
                    return [
                        'id' => $project->id,
                        'name' => $project->name,
                        'type' => $project->type,
                        'status' => $project->status,
                        'thumbnail' => $project->thumbnail,
                        'rooms' => $project->rooms_count,
                        'devices' => $project->devices_count,
                        'connections' => $project->connections_count,
                        'created_at' => $project->created_at,
                        'updated_at' => $project->updated_at,
                    ];
                })->values(),
        ]);
    }

    public function subscribe(Request $request)
    {
        $validated = $request->validate([
            'plan' => ['required', 'in:weekly,monthly,yearly'],
        ]);

        $user = Auth::user();
        $startedAt = now();
        $expiresAt = match ($validated['plan']) {
            'weekly' => $startedAt->copy()->addWeek(),
            'monthly' => $startedAt->copy()->addMonth(),
            'yearly' => $startedAt->copy()->addYear(),
        };

        $user->forceFill([
            'subscription_plan' => $validated['plan'],
            'subscription_started_at' => $startedAt,
            'subscription_expires_at' => $expiresAt,
        ])->save();

        return response()->json([
            'message' => 'Subscription activated successfully',
            'subscription' => [
                'plan' => $user->subscription_plan,
                'active' => true,
                'started_at' => $user->subscription_started_at,
                'expires_at' => $user->subscription_expires_at,
            ],
        ], 201);
    }
}