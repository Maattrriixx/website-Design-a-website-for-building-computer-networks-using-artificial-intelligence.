<?php

namespace App\Http\Controllers;

use App\Services\WiredNetworkService;
use App\Models\Project;
use App\Models\Device;
use App\Models\Room;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;


class DeviceController extends Controller
{
    public function runWiredOptimization($projectId, WiredNetworkService $wiredService)
    {
        $project = Project::findOrFail($projectId);

        if ($project->user_id !== Auth::id()) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $project->update(['status' => 'processing']);

        $result = $wiredService->optimizeProjectNetwork($project);

        if (!$result) {
            $project->update(['status' => 'error']);
            return response()->json([
                'success' => false,
                'message' => 'حدث خطأ أثناء معالجة الشبكة من خادم الذكاء الاصطناعي',
            ], 500);
        }

       $allowedTypes = [ 'Endpoint', 'Camera', 'Switch', 'Router', 'Firewall', 'Server', 'UPS', 'NVR', 'Core Switch', 'Proxy', 'Modem', 'DNS', 'DHCP',];
        $projectRoomIds = Room::where('project_id', $project->id)->pluck('id')->values()->all();

        DB::beginTransaction();
        try {
            Device::where('project_id', $project->id)->delete();
            \App\Models\Connection::where('project_id', $project->id)->delete();

            $deviceMapping = [];
            $groupedDevices = [];

            foreach ($result['devices'] ?? [] as $device) {
                if (!in_array($device['type'], $allowedTypes, true)) {
                    Log::warning("Unknown device type from wired API: " . ($device['type'] ?? 'null'));
                    continue;
                }

                $roomId = $device['room_id']
                    ?? (!empty($device['rooms']) ? $device['rooms'][0] : null);

                if ($roomId !== null && !in_array((int) $roomId, $projectRoomIds, true)) {
                    $roomId = null;
                }

                // ← بيقرا سواء كانت flat (vlan_id) أو nested (vlan.id)
                $vlanId = $device['vlan_id'] ?? ($device['vlan']['id'] ?? null);

                $groupKey = $device['type'] . '|' . $roomId . '|' . ($device['cluster_id'] ?? 'null') . '|' . $vlanId;

                if (!isset($groupedDevices[$groupKey])) {
                    $groupedDevices[$groupKey] = [
                        'device_ids' => [$device['device_id']],
                        'type'       => $device['type'],
                        'room_id'    => $roomId,
                        'cluster_id' => $device['cluster_id'] ?? null,
                        'vlan_id'    => $vlanId,
                        'x'          => (float) $device['x'],
                        'y'          => (float) $device['y'],
                        'ports'      => $device['ports'] ?? null,
                        'notes'      => $device['notes'] ?? null,
                        'quantity'   => 1,
                    ];
                } else {
                    $groupedDevices[$groupKey]['quantity']++;
                    $groupedDevices[$groupKey]['device_ids'][] = $device['device_id'];
                }
            }

            $devicesSavedCount = 0;
            $savedDevices = [];

            foreach ($groupedDevices as $grouped) {
                $saved = Device::create([
                    'project_id'  => $project->id,
                    'device_code' => 'DEV-' . $project->id . '-' . $grouped['device_ids'][0],
                    'type'        => $grouped['type'],
                    'room_id'     => $grouped['room_id'],
                    'cluster_id'  => $grouped['cluster_id'],
                    'vlan_id'     => $grouped['vlan_id'],
                    'x'           => $grouped['x'],
                    'y'           => $grouped['y'],
                    'ports'       => $grouped['ports'],
                    'status'      => 'planned',
                    'notes'       => $grouped['notes'],
                    'quantity'    => $grouped['quantity'],
                ]);

                foreach ($grouped['device_ids'] as $id) {
                    $deviceMapping[$id] = $saved->id;
                }

                $devicesSavedCount += $grouped['quantity'];
                $savedDevices[] = $saved;
            }

            $connectionsData = $result['connections'] ?? [];
            $savedConnections = [];

            foreach ($connectionsData as $conn) {
                $fromId = $deviceMapping[$conn['from']] ?? null;
                $toId   = $deviceMapping[$conn['to']] ?? null;

                if ($fromId && $toId) {
                    $savedConn = \App\Models\Connection::create([
                        'project_id'     => $project->id,
                        'from_device_id' => $fromId,
                        'to_device_id'   => $toId,
                        'type'           => $conn['type'],
                        'speed'          => $conn['speed'] ?? null,
                        'distance_m'     => (float) $conn['distance_m'],
                        'medium'         => $conn['medium'] ?? 'copper',
                    ]);
                    $savedConnections[] = $savedConn;
                }
            }

            $project->update([
                'status'           => 'completed',
                'total_device'     => $devicesSavedCount,
                'network_metadata' => isset($result['metadata']) ? json_encode($result['metadata']) : null,
            ]);
            if (isset($result['metadata']['room_areas_m2']) && is_array($result['metadata']['room_areas_m2'])) {
                foreach ($result['metadata']['room_areas_m2'] as $roomIdStr => $area) {
                    Room::where('id', $roomIdStr)
                        ->where('project_id', $project->id) // للتحقق من الأمان
                        ->update(['area' => (float) $area]);
                }
            }
            DB::commit();

            return response()->json([
                'success'               => true,
                'message'               => 'تمت معالجة الشبكة وحفظ الأجهزة بنجاح',
                'total_devices_saved'   => $devicesSavedCount,
                'grouped_devices_count' => count($groupedDevices),
                // ← عم نرجّع النسخة المحفوظة فعلياً (بمعرفات DB الصحيحة)، مش الخام
                'devices'               => $savedDevices,
                'connections'           => $savedConnections,
                'metadata'              => $result['metadata'] ?? [],
            ], 200);
        } catch (\Exception $e) {
            DB::rollBack();
            $project->update(['status' => 'error']);

            return response()->json([
                'success' => false,
                'message' => 'حدث خطأ أثناء حفظ هندسة الأجهزة والروابط: ' . $e->getMessage(),
            ], 500);
        }
    }


    // ============================================================
    // إضافة جهاز جديد — لازم يكون جوا غرفة محددة
    // ============================================================
    public function store(Request $request, $projectId)
    {
        $project = Project::findOrFail($projectId);

        if ($project->user_id !== Auth::id()) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $allowedTypes = [ 'Endpoint', 'Camera', 'Switch', 'Router', 'Firewall', 'Server', 'UPS', 'NVR', 'Core Switch', 'Proxy', 'Modem', 'DNS', 'DHCP',];

        $validated = $request->validate([
            'type'       => 'required|string|in:' . implode(',', $allowedTypes),
            'room_id'    => 'required|integer|exists:rooms,id',
            'quantity'   => 'nullable|integer|min:1',
            'vlan_id'    => 'nullable|integer',
            'cluster_id' => 'nullable|integer',
            'x'          => 'nullable|numeric',
            'y'          => 'nullable|numeric',
            'ports'      => 'nullable|integer',
            'model'      => 'nullable|string',
            'notes'      => 'nullable|string',
        ]);

        $belongsToProject = Room::where('id', $validated['room_id'])
            ->where('project_id', $project->id)
            ->exists();

        if (!$belongsToProject) {
            return response()->json(['error' => 'الغرفة المحددة لا تتبع هذا المشروع'], 422);
        }

        $requestedQuantity = $validated['quantity'] ?? 1;

        DB::beginTransaction();
        try {
            // ← دوّر عن جهاز موجود مسبقاً بنفس الخصائص (نفس منطق التجميع بالـ optimizer)
            $existingDevice = Device::where('project_id', $project->id)
                ->where('type', $validated['type'])
                ->where('room_id', $validated['room_id'])
                ->where('cluster_id', $validated['cluster_id'] ?? null)
                ->where('vlan_id', $validated['vlan_id'] ?? null)

                ->where('ports', $validated['ports'] ?? null)
                ->first();

            if ($existingDevice) {
                // موجود مسبقاً → زيد الكمية بدل ما تنشئ صف جديد
                $existingDevice->update([
                    'quantity' => $existingDevice->quantity + $requestedQuantity,
                ]);

                $this->recalculateTotalDevices($project);

                DB::commit();

                return response()->json([
                    'success' => true,
                    'message' => 'تمت زيادة كمية الجهاز الموجود بدلاً من إنشاء جهاز مكرر',
                    'device'  => $existingDevice->fresh(),
                    'merged'  => true,
                ], 200);
            }

            // مش موجود → أنشئ جهاز جديد
            $device = Device::create([
                'project_id'  => $project->id,
                'device_code' => 'DEV-' . $project->id . '-' . Str::random(8),
                'type'        => $validated['type'],
                'room_id'     => $validated['room_id'],
               // 'cluster_id'  => $validated['cluster_id'] ?? null,
                'vlan_id'     => $validated['vlan_id'] ?? null,
                'x'           => $validated['x'] ?? 0,
                'y'           => $validated['y'] ?? 0,
                'ports'       => $validated['ports'] ?? null,
               // 'model'       => $validated['model'] ?? null,
               // 'status'      => 'planned',
              //  'notes'       => $validated['notes'] ?? null,
                'quantity'    => $requestedQuantity,
            ]);

            $this->recalculateTotalDevices($project);

            DB::commit();

            return response()->json([
                'success' => true,
                'message' => 'تمت إضافة الجهاز بنجاح',
                'device'  => $device,
                'merged'  => false,
            ], 201);
        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => 'فشل إضافة الجهاز: ' . $e->getMessage(),
            ], 500);
        }
    }

    // ============================================================
    // تعديل كمية جهاز — لازم يكون الجهاز أصلاً تابع لغرفة
    // ============================================================
    public function updateQuantity(Request $request, $deviceId)
    {
        $device = Device::findOrFail($deviceId);
        $project = $device->project;

        if ($project->user_id !== Auth::id()) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        if ($device->room_id === null) {
            return response()->json([
                'error' => 'لا يمكن تعديل هذا الجهاز خارج سياق غرفة محددة',
            ], 422);
        }

        $validated = $request->validate([
            'quantity' => 'required|integer|min:0',
        ]);

        DB::beginTransaction();
        try {
            if ($validated['quantity'] <= 0) {
                $this->deleteDeviceWithConnections($device, $project);

                DB::commit();

                return response()->json([
                    'success' => true,
                    'message' => 'تم حذف الجهاز لأن الكمية أصبحت صفر',
                    'deleted' => true,
                ], 200);
            }

            $device->update(['quantity' => $validated['quantity']]);
            $this->recalculateTotalDevices($project);

            DB::commit();

            return response()->json([
                'success' => true,
                'message' => 'تم تحديث كمية الجهاز بنجاح',
                'device'  => $device->fresh(),
            ], 200);
        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => 'فشل تحديث الجهاز: ' . $e->getMessage(),
            ], 500);
        }
    }

    // ============================================================
    // حذف جهاز — لازم يكون تابع لغرفة أيضاً
    // ============================================================
    public function destroyDevice($deviceId)
    {
        $device = Device::findOrFail($deviceId);
        $project = $device->project;

        if ($project->user_id !== Auth::id()) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        if ($device->room_id === null) {
            return response()->json([
                'error' => 'لا يمكن حذف هذا الجهاز خارج سياق غرفة محددة',
            ], 422);
        }

        DB::beginTransaction();
        try {
            $this->deleteDeviceWithConnections($device, $project);

            DB::commit();

            return response()->json([
                'success' => true,
                'message' => 'تم حذف الجهاز بنجاح',
            ], 200);
        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => 'فشل حذف الجهاز: ' . $e->getMessage(),
            ], 500);
        }
    }

    // ============================================================
    // منطق الحذف المشترك (يستخدمه الاثنين فوق)
    // ============================================================
    private function deleteDeviceWithConnections(Device $device, Project $project): void
    {
        \App\Models\Connection::where('project_id', $project->id)
            ->where(function ($q) use ($device) {
                $q->where('from_device_id', $device->id)
                    ->orWhere('to_device_id', $device->id);
            })
            ->delete();

        $device->delete();

        $this->recalculateTotalDevices($project);
    }

    // ============================================================
    // إعادة حساب إجمالي عدد الأجهزة بالمشروع (مجموع quantity لكل الصفوف)
    // ============================================================
    private function recalculateTotalDevices(Project $project): void
    {
        $total = Device::where('project_id', $project->id)->sum('quantity');
        $project->update(['total_device' => $total]);
    }
}
