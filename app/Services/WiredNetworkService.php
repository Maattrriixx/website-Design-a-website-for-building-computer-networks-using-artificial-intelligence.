<?php
// app/Services/WiredNetworkService.php

namespace App\Services;

use App\Models\Project;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class WiredNetworkService
{
    protected string $apiUrl;

    public function __construct()
    {
        $this->apiUrl = config('services.wired_network.url');
    }

    /**
     * إرسال بيانات غرف المشروع إلى FastAPI (wired_designer.py) وجلب تصميم الشبكة السلكية
     *
     * @param Project $project
     * @return array|null
     */
    public function optimizeProjectNetwork(Project $project): ?array
    {
        $rooms = $project->rooms()->with('corners')->get();

        if ($rooms->isEmpty()) {
            Log::warning("Wired optimizer: project {$project->id} has no rooms.");
            return null;
        }

        $roomsData = $rooms->map(function ($room) {
            return [
                'id'                   => $room->id,
                'room_id'              => $room->id,
                'type'                 => $room->type,
                'center'               => [
                    'x' => (float) $room->center_x,
                    'y' => (float) $room->center_y,
                ],
                'corners'              => $room->corners->map(fn ($c) => [
                    'x' => (float) $c->x,
                    'y' => (float) $c->y,
                ])->values(),
                'transformer_features' => $room->transformer_features,
            ];
        })->values();

        $scale = match ($project->measure_of_draw) {
            '1/50'  => 0.025,
            '1/200' => 0.10,
            default => 0.05,
        };

        try {
            $response = Http::timeout(120)
                ->withHeaders(['Content-Type' => 'application/json'])
                ->post("{$this->apiUrl}/wired", [
                    'rooms' => $roomsData,
                    'scale' => $scale,
                ]);

            if ($response->successful()) {
                return $response->json();
            }

            Log::error("Wired API error for project {$project->id}: " . $response->body());
            return null;

        } catch (\Exception $e) {
            Log::error("Failed to reach wired API for project {$project->id}: " . $e->getMessage());
            return null;
        }
    }
}