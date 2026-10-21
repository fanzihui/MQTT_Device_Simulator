use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub mqtt_version: String,
    pub use_tls: bool,
    pub ca_cert_path: Option<String>,
    pub username: Option<String>,
    pub session_expiry_seconds: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceBatch {
    pub count: u16,
    pub device_id_prefix: String,
    pub client_id_prefix: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtoSchemaEntry {
    pub id: String,
    pub name: String,
    pub source: String,
    pub message_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub id: String,
    pub name: String,
    pub profile_id: String,
    #[serde(default)]
    pub mqtt_version: Option<String>,
    pub device_batch: DeviceBatch,
    pub topic_template: String,
    pub payload_format: String,
    pub json_template: String,
    pub schema_id: Option<String>,
    pub message_type: Option<String>,
    pub protobuf_values_json: String,
    pub qos: u8,
    pub retain: bool,
    #[serde(default)]
    pub publish_options: Option<PublishOptions>,
    #[serde(default)]
    pub field_ranges: HashMap<String, FieldRange>,
    pub interval_ms: u64,
    pub publish_count_per_device: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldRange {
    pub enabled: bool,
    pub min: f64,
    pub max: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceData {
    pub version: u32,
    pub profiles: Vec<BrokerProfile>,
    pub schemas: Vec<ProtoSchemaEntry>,
    pub scenarios: Vec<Scenario>,
}

impl Default for WorkspaceData {
    fn default() -> Self {
        Self {
            version: 1,
            profiles: Vec::new(),
            schemas: Vec::new(),
            scenarios: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerConnection {
    pub host: String,
    pub port: u16,
    pub mqtt_version: String,
    pub use_tls: bool,
    pub ca_cert_path: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub session_expiry_seconds: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStatus {
    pub device_id: String,
    pub client_id: String,
    pub status: String,
    pub error: Option<String>,
    pub success_count: u64,
    pub failure_count: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishOptions {
    pub qos: u8,
    pub retain: bool,
    pub message_expiry_seconds: Option<u32>,
    pub response_topic: Option<String>,
    pub correlation_data_base64: Option<String>,
    pub content_type: Option<String>,
    pub user_properties: Vec<(String, String)>,
}

impl Default for PublishOptions {
    fn default() -> Self {
        Self {
            qos: 1,
            retain: false,
            message_expiry_seconds: None,
            response_topic: None,
            correlation_data_base64: None,
            content_type: None,
            user_properties: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishRequest {
    pub device_id: String,
    pub topic: String,
    pub payload: Vec<u8>,
    pub payload_preview: String,
    pub payload_format: String,
    pub timestamp: String,
    pub options: PublishOptions,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishResult {
    pub device_id: String,
    pub topic: String,
    pub status: String,
    pub error: Option<String>,
    pub timestamp: String,
    pub payload_preview: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageEntry {
    pub id: String,
    pub direction: String,
    pub topic: String,
    pub timestamp: String,
    pub qos: u8,
    pub retain: bool,
    pub payload_format: String,
    pub payload_preview: String,
    pub payload_hex: String,
    pub device_id: Option<String>,
    pub properties: Vec<(String, String)>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemLogEntry {
    pub id: String,
    pub timestamp: String,
    pub level: String,
    pub message: String,
}
