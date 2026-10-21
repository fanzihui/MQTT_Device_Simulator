use std::{
    collections::HashMap,
    fs,
    net::{Ipv4Addr, SocketAddr},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use axum::{
    body::Body,
    extract::State as AxumState,
    http::{header, HeaderMap, Response, StatusCode},
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    net::TcpListener,
    sync::{oneshot, Mutex, RwLock},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const MCP_PORT: u16 = 39541;
const MCP_ENDPOINT: &str = "http://127.0.0.1:39541/mcp";
const CONFIG_FILE: &str = "mcp-settings.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpPermissions {
    #[serde(default = "default_true")]
    pub read_state: bool,
    #[serde(default)]
    pub connection_control: bool,
    #[serde(default)]
    pub simulation_control: bool,
    #[serde(default)]
    pub publish_messages: bool,
}

impl Default for McpPermissions {
    fn default() -> Self {
        Self {
            read_state: true,
            connection_control: false,
            simulation_control: false,
            publish_messages: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSettings {
    pub enabled: bool,
    pub token: String,
    #[serde(default)]
    pub permissions: McpPermissions,
    pub endpoint: String,
}

impl Default for McpSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            token: Uuid::new_v4().simple().to_string(),
            permissions: McpPermissions::default(),
            endpoint: MCP_ENDPOINT.to_string(),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSettings {
    token: String,
    #[serde(default)]
    permissions: McpPermissions,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpToolRequest {
    id: String,
    name: String,
    arguments: Value,
}

#[derive(Clone)]
pub struct McpService {
    inner: Arc<McpInner>,
}

struct McpInner {
    settings: RwLock<McpSettings>,
    initialized: AtomicBool,
    update_lock: Mutex<()>,
    server: Mutex<Option<ServerRuntime>>,
    pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
}

struct ServerRuntime {
    cancel: CancellationToken,
    task: JoinHandle<()>,
}

impl Default for McpService {
    fn default() -> Self {
        Self {
            inner: Arc::new(McpInner {
                settings: RwLock::new(McpSettings::default()),
                initialized: AtomicBool::new(false),
                update_lock: Mutex::new(()),
                server: Mutex::new(None),
                pending: Mutex::new(HashMap::new()),
            }),
        }
    }
}

impl McpService {
    async fn load(&self, app: &AppHandle) -> Result<McpSettings, String> {
        let _update_guard = self.inner.update_lock.lock().await;
        if !self.inner.initialized.load(Ordering::Acquire) {
            let path = settings_path(app)?;
            let settings = if path.exists() {
                let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
                let stored: PersistedSettings = serde_json::from_str(&contents)
                    .map_err(|error| format!("MCP 设置文件无法读取：{error}"))?;
                McpSettings {
                    enabled: false,
                    token: stored.token,
                    permissions: stored.permissions,
                    endpoint: MCP_ENDPOINT.to_string(),
                }
            } else {
                McpSettings::default()
            };
            *self.inner.settings.write().await = settings.clone();
            save_settings(app, &settings)?;
            self.inner.initialized.store(true, Ordering::Release);
        }
        Ok(self.inner.settings.read().await.clone())
    }

    async fn update(
        &self,
        app: &AppHandle,
        mut settings: McpSettings,
    ) -> Result<McpSettings, String> {
        let _update_guard = self.inner.update_lock.lock().await;
        if settings.token.trim().len() < 32 {
            return Err("MCP 令牌长度无效，请重新生成令牌。".to_string());
        }
        settings.endpoint = MCP_ENDPOINT.to_string();

        let was_running = self.inner.server.lock().await.is_some();

        let new_runtime = if settings.enabled && !was_running {
            Some(start_server(app.clone()).await?)
        } else {
            None
        };
        if let Err(error) = save_settings(app, &settings) {
            if let Some(runtime) = new_runtime {
                runtime.cancel.cancel();
                let _ = tokio::time::timeout(Duration::from_secs(2), runtime.task).await;
            }
            return Err(error);
        }
        if let Some(runtime) = new_runtime {
            *self.inner.server.lock().await = Some(runtime);
        }
        *self.inner.settings.write().await = settings.clone();
        self.inner.initialized.store(true, Ordering::Release);
        if !settings.enabled && was_running {
            self.stop_server().await;
        }
        Ok(settings)
    }

    async fn stop_server(&self) {
        if let Some(runtime) = self.inner.server.lock().await.take() {
            runtime.cancel.cancel();
            let _ = tokio::time::timeout(Duration::from_secs(2), runtime.task).await;
        }
    }

    async fn complete(
        &self,
        id: String,
        result: Option<Value>,
        error: Option<String>,
    ) -> Result<(), String> {
        let sender = self
            .inner
            .pending
            .lock()
            .await
            .remove(&id)
            .ok_or_else(|| "MCP 请求已结束或不存在。".to_string())?;
        let outcome = match error {
            Some(message) => Err(message),
            None => Ok(result.unwrap_or(Value::Null)),
        };
        sender
            .send(outcome)
            .map_err(|_| "MCP 客户端已断开。".to_string())
    }

    async fn call_frontend(
        &self,
        app: &AppHandle,
        name: String,
        arguments: Value,
    ) -> Result<Value, String> {
        let id = Uuid::new_v4().simple().to_string();
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.inner.pending.lock().await;
            if pending.len() >= 64 {
                return Err("当前 MCP 工具调用过多，请稍后重试。".to_string());
            }
            pending.insert(id.clone(), sender);
        }

        if let Err(error) = app.emit(
            "mcp-tool-request",
            McpToolRequest {
                id: id.clone(),
                name,
                arguments,
            },
        ) {
            self.inner.pending.lock().await.remove(&id);
            return Err(format!("无法向工作台发送 MCP 工具请求：{error}"));
        }

        match tokio::time::timeout(Duration::from_secs(45), receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("工作台已关闭，未能完成 MCP 工具调用。".to_string()),
            Err(_) => {
                self.inner.pending.lock().await.remove(&id);
                Err("等待工作台响应超时。".to_string())
            }
        }
    }
}

#[tauri::command]
pub async fn mcp_load_settings(
    app: AppHandle,
    service: State<'_, McpService>,
) -> Result<McpSettings, String> {
    service.inner().load(&app).await
}

#[tauri::command]
pub async fn mcp_update_settings(
    app: AppHandle,
    service: State<'_, McpService>,
    settings: McpSettings,
) -> Result<McpSettings, String> {
    service.inner().update(&app, settings).await
}

#[tauri::command]
pub async fn mcp_rotate_token(
    app: AppHandle,
    service: State<'_, McpService>,
) -> Result<McpSettings, String> {
    let mut settings = service.inner().load(&app).await?;
    settings.token = Uuid::new_v4().simple().to_string();
    service.inner().update(&app, settings).await
}

#[tauri::command]
pub async fn mcp_complete_tool(
    service: State<'_, McpService>,
    id: String,
    result: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    service.inner().complete(id, result, error).await
}

async fn start_server(app: AppHandle) -> Result<ServerRuntime, String> {
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, MCP_PORT));
    let listener = TcpListener::bind(address)
        .await
        .map_err(|error| format!("无法启动本机 MCP 服务（{MCP_ENDPOINT}）：{error}"))?;
    let router = Router::new()
        .route("/mcp", post(handle_mcp))
        .with_state(app)
        .layer(axum::extract::DefaultBodyLimit::max(1024 * 1024));
    let cancel = CancellationToken::new();
    let shutdown = cancel.clone();
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(shutdown.cancelled_owned())
            .await;
    });
    Ok(ServerRuntime { cancel, task })
}

async fn handle_mcp(
    AxumState(app): AxumState<AppHandle>,
    headers: HeaderMap,
    Json(request): Json<Value>,
) -> Response<Body> {
    let service = app.state::<McpService>();
    let settings = service.inner().inner.settings.read().await.clone();
    if !settings.enabled {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }

    let expected_host = format!("127.0.0.1:{MCP_PORT}");
    if headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|host| host != expected_host)
        || headers.contains_key(header::ORIGIN)
    {
        return StatusCode::FORBIDDEN.into_response();
    }

    let token_ok = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == format!("Bearer {}", settings.token));
    if !token_ok {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let accept = headers
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !accept.is_empty()
        && !accept.contains("application/json")
        && !accept.contains("text/event-stream")
    {
        return StatusCode::NOT_ACCEPTABLE.into_response();
    }

    let Some(method) = request.get("method").and_then(Value::as_str) else {
        return rpc_error(
            request.get("id").cloned().unwrap_or(Value::Null),
            -32600,
            "Invalid Request",
        );
    };
    let id = request.get("id").cloned();
    let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
    let protocol_header = headers
        .get("mcp-protocol-version")
        .and_then(|value| value.to_str().ok());
    if id.is_none() {
        return StatusCode::ACCEPTED.into_response();
    }

    let response = match method {
        "initialize" => {
            let requested = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("2025-06-18");
            let protocol_version =
                if ["2024-11-05", "2025-03-26", "2025-06-18"].contains(&requested) {
                    requested
                } else {
                    "2025-06-18"
                };
            rpc_success(
                id.unwrap(),
                json!({
                    "protocolVersion": protocol_version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "telemetry-studio", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": "本机 MQTT 设备模拟器。工具权限由用户在桌面应用设置中控制。"
                }),
                protocol_header,
            )
        }
        "ping" => rpc_success(id.unwrap(), json!({}), protocol_header),
        "tools/list" => rpc_success(
            id.unwrap(),
            json!({ "tools": list_tools(&settings.permissions) }),
            protocol_header,
        ),
        "tools/call" => {
            let name = params
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let group = tool_permission(name);
            let allowed = group
                .is_some_and(|permission| permission_enabled(&settings.permissions, permission));
            if group.is_none() {
                rpc_success(
                    id.unwrap(),
                    tool_error(format!("未知的 MCP 工具：{name}")),
                    protocol_header,
                )
            } else if !allowed {
                rpc_success(
                    id.unwrap(),
                    tool_error("此类 MCP 工具已在应用设置中关闭。".to_string()),
                    protocol_header,
                )
            } else {
                let service = service.inner().clone();
                match service.call_frontend(&app, name.to_string(), args).await {
                    Ok(value) => rpc_success(id.unwrap(), tool_result(value), protocol_header),
                    Err(error) => rpc_success(id.unwrap(), tool_error(error), protocol_header),
                }
            }
        }
        _ => rpc_error(id.unwrap(), -32601, "Method not found"),
    };
    response
}

fn tool_permission(name: &str) -> Option<&'static str> {
    match name {
        "get_simulator_status" => Some("readState"),
        "connect_devices"
        | "disconnect_devices"
        | "retry_failed_devices"
        | "start_monitor"
        | "stop_monitor" => Some("connectionControl"),
        "start_simulation" | "stop_simulation" => Some("simulationControl"),
        "publish_once" => Some("publishMessages"),
        _ => None,
    }
}

fn permission_enabled(permissions: &McpPermissions, permission: &str) -> bool {
    match permission {
        "readState" => permissions.read_state,
        "connectionControl" => permissions.connection_control,
        "simulationControl" => permissions.simulation_control,
        "publishMessages" => permissions.publish_messages,
        _ => false,
    }
}

fn list_tools(permissions: &McpPermissions) -> Vec<Value> {
    let definitions = [
        (
            "get_simulator_status",
            "读取当前连接、设备状态、场景和发送计数器。",
            "readState",
        ),
        (
            "connect_devices",
            "使用工作台当前连接配置启动设备批次。",
            "connectionControl",
        ),
        (
            "disconnect_devices",
            "停止定时发送、订阅监视并断开设备批次。",
            "connectionControl",
        ),
        (
            "retry_failed_devices",
            "重试当前失败或断开的设备。",
            "connectionControl",
        ),
        (
            "start_monitor",
            "按工作台当前订阅主题启动接收监视。",
            "connectionControl",
        ),
        ("stop_monitor", "停止接收订阅监视。", "connectionControl"),
        (
            "start_simulation",
            "按当前场景配置开始定时发送。",
            "simulationControl",
        ),
        ("stop_simulation", "停止定时发送。", "simulationControl"),
        (
            "publish_once",
            "按当前载荷和发布选项立即发送一轮。",
            "publishMessages",
        ),
    ];
    definitions
        .into_iter()
        .filter(|(_, _, permission)| permission_enabled(permissions, permission))
        .map(|(name, description, _)| {
            json!({
                "name": name,
                "description": description,
                "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
            })
        })
        .collect()
}

fn rpc_success(id: Value, result: Value, protocol_version: Option<&str>) -> Response<Body> {
    let mut response =
        Json(json!({ "jsonrpc": "2.0", "id": id, "result": result })).into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/json"),
    );
    if let Some(version) =
        protocol_version.and_then(|value| header::HeaderValue::from_str(value).ok())
    {
        response
            .headers_mut()
            .insert("mcp-protocol-version", version);
    }
    response
}

fn rpc_error(id: Value, code: i32, message: &str) -> Response<Body> {
    Json(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }))
        .into_response()
}

fn tool_result(value: Value) -> Value {
    let text = serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string());
    json!({
        "content": [{ "type": "text", "text": text }],
        "structuredContent": value,
        "isError": false
    })
}

fn tool_error(message: String) -> Value {
    json!({ "content": [{ "type": "text", "text": message }], "isError": true })
}

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(CONFIG_FILE))
}

fn save_settings(app: &AppHandle, settings: &McpSettings) -> Result<(), String> {
    let persisted = PersistedSettings {
        token: settings.token.clone(),
        permissions: settings.permissions.clone(),
    };
    let contents = serde_json::to_string_pretty(&persisted).map_err(|error| error.to_string())?;
    fs::write(settings_path(app)?, contents).map_err(|error| error.to_string())
}

fn default_true() -> bool {
    true
}
