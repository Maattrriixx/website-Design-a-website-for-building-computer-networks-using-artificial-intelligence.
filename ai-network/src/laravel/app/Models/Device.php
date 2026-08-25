<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Device extends Model
{
    use HasFactory;

    protected $fillable = [
        'project_id',
        'room_id',
        'device_code',
        'type',
        'cluster_id',
        'x',
        'y',
        'ports',
        'model',
        'status',
        'notes'
    ];

    // علاقة الجهاز بالمشروع
    public function project()
    {
        return $this->belongsTo(Project::class);
    }

    public function room()
    {
        return $this->belongsTo(Room::class);
    }
}
