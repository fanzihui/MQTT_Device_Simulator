#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mqtt_device_simulator_lib::run();
}
