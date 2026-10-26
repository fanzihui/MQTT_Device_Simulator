mod mcp;
mod models;
mod mqtt;
mod storage;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(mqtt::MqttService::default())
        .manage(mcp::McpService::default())
        .invoke_handler(tauri::generate_handler![
            mqtt::start_batch,
            mqtt::retry_device,
            mqtt::stop_batch,
            mqtt::publish_messages,
            mqtt::start_monitor,
            mqtt::stop_monitor,
            storage::load_workspace,
            storage::save_workspace,
            mcp::mcp_load_settings,
            mcp::mcp_update_settings,
            mcp::mcp_rotate_token,
            mcp::mcp_complete_tool
        ])
        .run(tauri::generate_context!())
        .expect("failed to run MQTT Device Simulator");
}
