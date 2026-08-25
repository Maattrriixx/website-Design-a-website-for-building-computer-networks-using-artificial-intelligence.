<?php

namespace App\Http\Controllers;

use App\Models\Project;
use App\Models\Room;
use App\Http\Requests\StoreProject;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Intervention\Image\Drivers\Gd\Driver;
use Intervention\Image\Facades\Image;
use Intervention\Image\ImageManager;
use Illuminate\Support\Facades\DB;

class ProjectController extends Controller
{
    public function getProjectSettings()
    {
        return response()->json([
            'available_measures' => ['1/50', '1/100', '1/200'],
            'project_types'      => ['university', 'bank', 'residential', 'commercial']
        ], 200);
    }
    public function StoreProject(StoreProject $req)
    {
        // البيانات مفلترة ومحتوية على كل شروط الـ Validation
        $validated = $req->validated();

        // 1. حفظ الصورة الرئيسية
        $image = $req->file('image');
        $path = $image->store('projects', 'public');

        $validated['image'] = 'storage/' . $path;
        $validated['user_id'] = Auth::id();

        // 2. معالجة وإنشاء الصورة المصغرة (Thumbnail)
        $manager = new ImageManager(new Driver());
        $thumb = $manager->read($image)->resize(200, 200);

        $thumbName = 'thumb_' . uniqid() . '_' . time() . '.jpg';
        $thumbPath = 'thumbnails/' . $thumbName;

        Storage::disk('public')->put($thumbPath, (string) $thumb->toJpeg(80));

        $validated['thumbnail'] = 'storage/' . $thumbPath;

        // 3. إنشاء المشروع في قاعدة البيانات
        $project = Project::create($validated);

        return response()->json([
            'message' => 'Project created successfully',
            'project' => $project
        ], 201);
    }


    public function analyzeProject(Project $project)
    {
        if ($project->user_id !== Auth::id()) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $project->status = 'processing';
        $project->save();

        try {
            $imagePath = str_replace('storage/', '', $project->image);
            $imageFullPath = Storage::disk('public')->path($imagePath);

            if (!file_exists($imageFullPath)) {
                throw new \Exception('Image file not found');
            }

            $response = Http::timeout(120)
                ->attach('image', fopen($imageFullPath, 'r'), basename($imageFullPath))
                ->post('http://127.0.0.1:5000/predict', [
                    'measure_of_draw' => $project->measure_of_draw,
                ]);

            if (!$response->successful()) {
                throw new \Exception('Python API error: ' . $response->body());
            }

            $data = $response->json();

            if (isset($data['is_valid_blueprint']) && !$data['is_valid_blueprint']) {
                throw new \Exception('Invalid architectural blueprint');
            }

            $roomsData = $data['rooms'] ?? $data['detected_rooms'] ?? [];

            if (empty($roomsData)) {
                Log::warning('Flask API returned 0 rooms for project ID: ' . $project->id);
            }

            $project->rooms()->delete();
            $savedRooms = [];

            foreach ($roomsData as $roomData) {
                $room = Room::create([
                    'project_id'           => $project->id,
                    'confidence'           => $roomData['confidence'] ?? 1.0,
                    'center_x'             => $roomData['center']['x'] ?? 0,
                    'center_y'             => $roomData['center']['y'] ?? 0,
                    'type'                 => $roomData['type'] ?? null,
                    'transformer_features' => $roomData['transformer_features'] ?? null, // جديد
                ]);

                if (isset($roomData['corners']) && is_array($roomData['corners'])) {
                    foreach ($roomData['corners'] as $index => $cornerData) {
                        $room->corners()->create([
                            'x'           => $cornerData['x'],
                            'y'           => $cornerData['y'],
                            'order_index' => $index,
                        ]);
                    }
                }

                $savedRooms[] = $room->load('corners');
            }

            $project->num_rooms = count($savedRooms);
            $project->status = 'completed';
            $project->save();

            return response()->json([
                'message'              => 'Analysis completed',
                'project'              => $project,
                'num_rooms'            => count($savedRooms),
                'rooms'                => $savedRooms,
                'labeled_image_base64' => $data['labeled_image_base64'] ?? null,
            ]);
        } catch (\Exception $e) {
            $project->status = 'error';
            $project->save();

            return response()->json([
                'message' => 'Analysis failed',
                'project' => $project,
                'error'   => $e->getMessage(),
            ], 500);
        }
    }
public function getFullProject($projectId)
{
    $project = Project::with([
        'rooms.corners',
        'devices',
        'connections',
    ])->findOrFail($projectId);

    if ($project->user_id !== Auth::id()) {
        return response()->json(['error' => 'Unauthorized'], 403);
    }

    return response()->json([
        'success' => true,
        'message' => 'تم جلب بيانات المشروع بالكامل بنجاح.',
        'project' => [
            'id'              => $project->id,
            'name'            => $project->name,
            'type'            => $project->type,
            'description'     => $project->description,
            'status'          => $project->status,
            'image'           => $project->image,
            'image_url'       => $project->image_url,
            'thumbnail'       => $project->thumbnail,
            'thumbnail_url'   => $project->thumbnail_url,
            'num_rooms'       => $project->num_rooms,
            'total_device'    => $project->total_device,
            'measure_of_draw' => $project->measure_of_draw,
            'metadata'        => $project->network_metadata,
            'created_at'      => $project->created_at,
            'updated_at'      => $project->updated_at,

            // كل غرفة مع زواياها مرتبة (corners() فيها orderBy('order_index'))
            'rooms' => $project->rooms->map(function ($room) {
                return [
                    'id'                   => $room->id,
                    'type'                 => $room->type,
                    'confidence'           => $room->confidence,
                    'center_x'             => $room->center_x,
                    'center_y'             => $room->center_y,
                    'transformer_features' => $room->transformer_features,
                    'corners' => $room->corners->map(fn ($c) => [
                        'x'           => $c->x,
                        'y'           => $c->y,
                        'order_index' => $c->order_index,
                    ])->values(),
                ];
            })->values(),

            // كل الأجهزة (بما فيها اللي بدون غرفة زي Router/Firewall/Server/UPS)
            'devices' => $project->devices,

            // كل التوصيلات بين الأجهزة
            'connections' => $project->connections,
        ],
    ], 200);
}

    public function GetUserProjects()
    {
        $projects = Project::where('user_id', Auth::id())
            ->select('id', 'name', 'type', 'thumbnail')
            ->get();

        return response()->json($projects);
    }
public function DeleteProject(Project $project)
{
    if ($project->user_id !== Auth::id()) {
        return response()->json(['error' => 'Unauthorized'], 403);
    }

    DB::transaction(function () use ($project) {
        // التوصيلات أولاً (بترجع لأجهزة)
        \App\Models\Connection::where('project_id', $project->id)->delete();

        // الأجهزة
        \App\Models\Device::where('project_id', $project->id)->delete();

        // زوايا كل غرفة بالمشروع، ثم الغرف نفسها
        $roomIds = \App\Models\Room::where('project_id', $project->id)->pluck('id');
        \App\Models\RoomCorner::whereIn('room_id', $roomIds)->delete();
        \App\Models\Room::where('project_id', $project->id)->delete();

        $project->delete();
    });

    return response()->json(['message' => 'Project deleted successfully']);
}


    public function getProjectTopology($projectId)
    {
        $project = Project::with(['rooms.corners', 'devices', 'connections'])
            ->findOrFail($projectId);

        if ($project->user_id !== Auth::id()) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        return response()->json([
            'success' => true,
            'message' => 'تم جلب بيانات المخطط الهيكلي للمشروع بنجاح.',
            'project' => [
                'id'               => $project->id,
                'name'             => $project->name,
                'type'             => $project->type,
                'description'      => $project->description,
                'image'            => $project->image,
                'thumbnail'        => $project->thumbnail,
                'status'           => $project->status,
                'num_rooms'        => $project->num_rooms,
                'total_device'     => $project->total_device,
                'measure_of_draw'  => $project->measure_of_draw,
                'metadata'         => $project->network_metadata,
                'created_at'       => $project->created_at,
                // ← لازم تكون هون، جوا project، مش برا
                'rooms'            => $project->rooms,
                'devices'          => $project->devices,
                'connections'      => $project->connections,
            ],
        ], 200);
    }
    public function getImageDimensions($projectId)
{
    $project = Project::findOrFail($projectId);

    // التحقق من الصلاحيات
    if ($project->user_id !== Auth::id()) {
        return response()->json(['error' => 'Unauthorized'], 403);
    }

    if (!$project->image) {
        return response()->json(['error' => 'No image path found in database'], 404);
    }

    // تنظيف المسار وإزالة بادئة storage/ للحصول على المسار الحقيقي داخل الديسك
    $imagePath = str_replace('storage/', '', $project->image);
    $imageFullPath = Storage::disk('public')->path($imagePath);

    if (!file_exists($imageFullPath)) {
        return response()->json(['error' => 'Image file not found on server'], 404);
    }

    $size = getimagesize($imageFullPath);

    if (!$size) {
        return response()->json(['error' => 'Unable to get image dimensions'], 422);
    }

    return response()->json([
        'success'    => true,
        'project_id' => $project->id,
        'width'      => $size[0], // العرض بالبكسل
        'height'     => $size[1], // الارتفاع بالبكسل
    ], 200);
}
      public function roomsWithDevices(Project $project)
    {
        $project->load(['rooms.devices']);

        return response()->json([
            'project_name' => $project->name,
            'rooms' => $project->rooms->map(function ($room) {
                return [
                    'room_id'   => $room->id,
                    'room_type' => $room->type,
                    'devices'   => $this->buildDevicesList($room->devices),
                ];
            }),
        ]);
    }

    private function buildDevicesList($devices)
    {
        $result = [];
        $endpointCameraTotal = 0;

        foreach ($devices as $device) {
            $result[] = [
                //'device_code' => $device->device_code,
                'type'        => $device->type,
                'quantity'    => $device->quantity,
               // 'model'       => $device->model,
              //  'status'      => $device->status,
            ];

            if (in_array($device->type, ['Endpoint', 'Camera'])) {
                $endpointCameraTotal += $device->quantity;
            }

            if (in_array($device->type, ['Switch', 'Core Switch'])) {
                $ports = $device->ports ?? 0;

                // الكابينة: Switch عادي -> Rack | Core Switch -> Wall
                $cabinetType = $device->type === 'Core Switch'
                    ? 'WALL CABINET'
                    : 'RACK CABINET';

                $result[] = [
                   // 'device_code' => $device->device_code . '-CAB',
                    'type'        => $cabinetType,
                    'quantity'    => 1,
                    //'model'       => null,
                    //'status'      => $device->status,
                ];

                $result[] = [
                  //  'device_code' => $device->device_code . '-PP-UTP',
                    'type'        => 'Patchpanel utp',
                    'quantity'    => $ports,
                   // 'model'       => null,
                    //'status'      => $device->status,
                ];

                if ($device->type === 'Core Switch') {
                    $result[] = [
                        //'device_code' => $device->device_code . '-PP-FIBER',
                        'type'        => 'Patchpantel fiber',
                        'quantity'    => $ports,
                        //'model'       => null,
                        //'status'      => $device->status,
                    ];
                }
            }
        }

        if ($endpointCameraTotal > 0) {
            $result[] = [
              //  'device_code' => 'ROOM-OUTLET',
                'type'        => 'Outlet',
                'quantity'    => $endpointCameraTotal,
                //'model'       => null,
                //'status'      => 'planned',
            ];
        }

        return $result;
    }
    
}
