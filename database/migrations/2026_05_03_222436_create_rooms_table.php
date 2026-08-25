<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rooms', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->constrained()->onDelete('cascade');

            $table->float('confidence')->default(1.0);
            $table->float('center_x')->nullable();
            $table->float('center_y')->nullable();
            $table->float('area', 10, 2)->nullable();
            $table->enum('type', [
              'laboratories',
                'classroom',
                'administrative office',
                'secretary',
                'café',
                'lobby',
                'dr.office',
                'server room',
                'library',
                'meeting room',
                'security' ,
                'wc',
                'other',            
            ])->nullable();

            $table->json('transformer_features')->nullable();

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rooms');
    }
};