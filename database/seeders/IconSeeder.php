<?php

namespace Database\Seeders;

use App\Models\Icon;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class IconSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        $icon = [
            [
                'name' => 'Router',
                'icon' => 'icon\router.png'
            ],
            [
                'name' => 'Server',
                'icon' => 'icon\server.png'
            ],
            [
                'name' => 'Modem',
                'icon' => 'icon\modem.png'
            ],
            [
                'name' => 'Endpoint',
                'icon' => 'icon\pc.png'
            ],



            [
                'name' => 'Firewall',
                'icon' => 'icon\firewall.png'
            ],


            [
                'name' => 'Switch',
                'icon' => 'icon\switch.png'
            ],
            [
                'name' => 'NVR',
                'icon' => 'icon/NVR.png'
            ],
            [
                'name' => 'Core Switch',
                'icon' => 'icon\Core Switch.png'
            ],
            [
                'name' => 'Proxy',
                'icon' => 'icon/Proxy.png'
            ],
            [
                'name' => 'DNS',
                'icon' => 'icon/DNS.png'
            ],
            [
                'name' => 'DHCP',
                'icon' => 'icon/DHCP.png'
            ],
            [
                'name' => 'RACK CABINET',
                'icon' => 'icon/RACK CABINET.png'
            ],
            [
                'name' => 'UPS',
                'icon' => 'icon/UPS.png'
            ],
            [
                'name' => 'camera',
                'icon' => 'icon/camera.jfif'
            ],
            [
                'name' => 'WALL CABINET',
                'icon' => 'icon/WALLCABINET.png'
            ],
        ];
        foreach ($icon as $item) {
            Icon::create($item);
        }
    }
}
