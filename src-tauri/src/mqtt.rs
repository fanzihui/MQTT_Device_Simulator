use std::{
    collections::{HashMap, VecDeque},
    fs,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use base64::Engine;
use chrono::Utc;
use rumqttc::{
    v5::{
        mqttbytes::v5::{ConnectProperties, Packet as V5Packet, PublishProperties},
        AsyncClient as V5Client, Event as V5Event, EventLoop as V5EventLoop,
        MqttOptions as V5Options,
    },
    AsyncClient as V4Client, Event as V4Event, EventLoop as V4EventLoop, MqttOptions as V4Options,
    Outgoing, Packet as V4Packet, QoS, Transport,
};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{watch, Mutex, RwLock};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::models::{
    BrokerConnection, DeviceBatch, DeviceStatus, MessageEntry, PublishOptions, PublishRequest,
    PublishResult, SystemLogEntry,
};

#[derive(Default)]
pub struct MqttService {
    devices: Mutex<HashMap<String, DeviceEntry>>,
    monitor: Mutex<Option<MonitorEntry>>,
}

struct DeviceEntry {
    connection: BrokerConnection,
    client_id: String,
    status: std::sync::Arc<RwLock<DeviceStatus>>,
    runtime: Option<DeviceRuntime>,
}

#[derive(Clone)]
struct DeviceRuntime {
    client: DeviceClient,
    cancel: CancellationToken,
    shutdown: watch::Sender<bool>,
    suppress_stop_event: Arc<AtomicBool>,
    outgoing: std::sync::Arc<Mutex<VecDeque<PublishRequest>>>,
    pending: std::sync::Arc<Mutex<HashMap<u16, PublishRequest>>>,
}

#[derive(Clone)]
enum DeviceClient {
    V4(V4Client),
    V5(V5Client),
}

enum DeviceEventLoop {
    V4(V4EventLoop),
    V5(V5EventLoop),
}

enum DeviceEvent {
    V4(V4Event),
    V5(V5Event),
}

struct MonitorEntry {
    cancel: CancellationToken,
}

#[tauri::command]
pub async fn start_batch(
    app: AppHandle,
    service: State<'_, MqttService>,
    connection: BrokerConnection,
    batch: DeviceBatch,
) -> Result<Vec<DeviceStatus>, String> {
    if batch.count == 0 || batch.count > 100 {
        return Err("设备数量必须在 1 到 100 之间。".to_string());
    }
    validate_connection(&connection)?;
    stop_all_devices(service.inner(), true).await;

    let mut statuses = Vec::with_capacity(batch.count as usize);
    for index in 1..=batch.count {
        let device_id = format!("{}{:03}", batch.device_id_prefix, index);
        let client_id = format!("{}{:03}", batch.client_id_prefix, index);
        statuses.push(
            start_device(
                app.clone(),
                service.inner(),
                connection.clone(),
                device_id,
                client_id,
            )
            .await,
        );
    }
    Ok(statuses)
}

#[tauri::command]
pub async fn retry_device(
    app: AppHandle,
    service: State<'_, MqttService>,
    device_id: String,
) -> Result<DeviceStatus, String> {
    let (connection, client_id, mut shutdown) = {
        let mut devices = service.devices.lock().await;
        let entry = devices
            .remove(&device_id)
            .ok_or_else(|| format!("未找到设备 {device_id}"))?;
        let shutdown = if let Some(runtime) = entry.runtime {
            let shutdown = runtime.shutdown.subscribe();
            runtime.suppress_stop_event.store(true, Ordering::Relaxed);
            runtime.cancel.cancel();
            Some(shutdown)
        } else {
            None
        };
        (entry.connection, entry.client_id, shutdown)
    };
    if let Some(shutdown) = shutdown.as_mut() {
        let _ = tokio::time::timeout(Duration::from_secs(2), shutdown.changed()).await;
    }
    validate_connection(&connection)?;
    Ok(start_device(app, service.inner(), connection, device_id, client_id).await)
}

#[tauri::command]
pub async fn stop_batch(service: State<'_, MqttService>) -> Result<(), String> {
    stop_all_devices(service.inner(), false).await;
    Ok(())
}

#[tauri::command]
pub async fn publish_messages(
    app: AppHandle,
    service: State<'_, MqttService>,
    messages: Vec<PublishRequest>,
) -> Result<(), String> {
    for message in messages {
        if !(0..=2).contains(&message.options.qos) {
            let error = "QoS 必须是 0、1 或 2。".to_string();
            emit_result(&app, &message, "failed", Some(error.clone()));
            update_counters(&app, &service, &message.device_id, false).await;
            log(
                &app,
                "error",
                format!("{} 发布失败：{error}", message.device_id),
            );
            continue;
        }

        let runtime_and_version = {
            let devices = service.devices.lock().await;
            match devices.get(&message.device_id) {
                Some(entry) => {
                    let status = entry.status.read().await;
                    if status.status != "connected" {
                        Err(format!("设备 {} 当前未连接。", message.device_id))
                    } else if let Some(runtime) = entry.runtime.clone() {
                        Ok((runtime, entry.connection.mqtt_version.clone()))
                    } else {
                        Err(format!("设备 {} 尚未建立连接。", message.device_id))
                    }
                }
                None => Err(format!("设备 {} 不存在。", message.device_id)),
            }
        };
        let (runtime, mqtt_version) = match runtime_and_version {
            Ok(value) => value,
            Err(error) => {
                emit_result(&app, &message, "failed", Some(error.clone()));
                update_counters(&app, &service, &message.device_id, false).await;
                log(
                    &app,
                    "error",
                    format!("{} 发布失败：{error}", message.device_id),
                );
                continue;
            }
        };

        if mqtt_version != "5.0" && has_mqtt5_properties(&message.options) {
            let error = "MQTT 3.1.1 不支持 MQTT 5.0 发布属性。".to_string();
            emit_result(&app, &message, "failed", Some(error.clone()));
            update_counters(&app, &service, &message.device_id, false).await;
            log(
                &app,
                "error",
                format!("{} 发布失败：{error}", message.device_id),
            );
            continue;
        }

        runtime.outgoing.lock().await.push_back(message.clone());
        let publish_result = publish_one(&runtime.client, &message).await;
        if let Err(error) = publish_result {
            remove_queued(&runtime.outgoing, &message).await;
            emit_result(&app, &message, "failed", Some(error.clone()));
            update_counters(&app, &service, &message.device_id, false).await;
            log(
                &app,
                "error",
                format!("{} 发布失败：{error}", message.device_id),
            );
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn start_monitor(
    app: AppHandle,
    service: State<'_, MqttService>,
    connection: BrokerConnection,
    topic_filters: Vec<String>,
) -> Result<(), String> {
    validate_connection(&connection)?;
    if topic_filters.is_empty() {
        return Err("请至少填写一个订阅主题过滤器。".to_string());
    }
    stop_monitor_inner(service.inner()).await;

    let client_id = format!(
        "mqtt-sim-monitor-{}",
        &Uuid::new_v4().simple().to_string()[..8]
    );
    let (client, mut event_loop) = make_client(&connection, &client_id)?;
    for topic in topic_filters {
        match &client {
            DeviceClient::V4(client) => client
                .subscribe(topic.clone(), QoS::AtLeastOnce)
                .await
                .map_err(|error| format!("订阅 {topic} 失败：{error}"))?,
            DeviceClient::V5(client) => client
                .subscribe(topic.clone(), rumqttc::v5::mqttbytes::QoS::AtLeastOnce)
                .await
                .map_err(|error| format!("订阅 {topic} 失败：{error}"))?,
        }
    }

    let cancel = CancellationToken::new();
    *service.monitor.lock().await = Some(MonitorEntry {
        cancel: cancel.clone(),
    });
    let client_keepalive = client.clone();
    tauri::async_runtime::spawn(async move {
        let _client_keepalive = client_keepalive;
        emit_log(&app, "info", "订阅监视客户端正在连接。".to_string());
        let mut backoff = 1_u64;
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                event = event_loop.poll() => match event {
                    Ok(event) => {
                        backoff = 1;
                        if matches!(
                            &event,
                            DeviceEvent::V4(V4Event::Incoming(V4Packet::ConnAck(_)))
                                | DeviceEvent::V5(V5Event::Incoming(V5Packet::ConnAck(_)))
                        ) {
                            emit_log(&app, "success", "订阅监视客户端已连接。".to_string());
                        }
                        if let Some(message) = monitor_message(event) {
                            let _ = app.emit("inbound-message", message);
                        }
                    }
                    Err(error) => {
                        emit_log(&app, "warning", format!("订阅连接中断，{backoff} 秒后重试：{error}"));
                        tokio::select! {
                            _ = cancel.cancelled() => break,
                            _ = tokio::time::sleep(Duration::from_secs(backoff)) => {}
                        }
                        backoff = (backoff * 2).min(30);
                    }
                }
            }
        }
        emit_log(&app, "info", "订阅监视客户端已停止。".to_string());
    });
    Ok(())
}

#[tauri::command]
pub async fn stop_monitor(service: State<'_, MqttService>) -> Result<(), String> {
    stop_monitor_inner(service.inner()).await;
    Ok(())
}

async fn start_device(
    app: AppHandle,
    service: &MqttService,
    connection: BrokerConnection,
    device_id: String,
    client_id: String,
) -> DeviceStatus {
    let status = std::sync::Arc::new(RwLock::new(DeviceStatus {
        device_id: device_id.clone(),
        client_id: client_id.clone(),
        status: "connecting".to_string(),
        error: None,
        success_count: 0,
        failure_count: 0,
    }));
    emit_device_status(&app, &status).await;

    let (client, event_loop) = match make_client(&connection, &client_id) {
        Ok(client) => client,
        Err(error) => {
            set_device_state(&app, &status, "error", Some(error.clone())).await;
            log(&app, "error", format!("{device_id} 连接配置错误：{error}"));
            service.devices.lock().await.insert(
                device_id,
                DeviceEntry {
                    connection,
                    client_id,
                    status: status.clone(),
                    runtime: None,
                },
            );
            let snapshot = status.read().await.clone();
            return snapshot;
        }
    };

    let runtime = DeviceRuntime {
        client,
        cancel: CancellationToken::new(),
        shutdown: watch::channel(false).0,
        suppress_stop_event: Arc::new(AtomicBool::new(false)),
        outgoing: std::sync::Arc::new(Mutex::new(VecDeque::new())),
        pending: std::sync::Arc::new(Mutex::new(HashMap::new())),
    };
    let task_runtime = runtime.clone();
    let task_status = status.clone();
    let task_device_id = device_id.clone();
    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        run_device_loop(
            app_for_task,
            task_device_id,
            task_status,
            task_runtime,
            event_loop,
        )
        .await;
    });
    service.devices.lock().await.insert(
        device_id,
        DeviceEntry {
            connection,
            client_id,
            status: status.clone(),
            runtime: Some(runtime),
        },
    );
    let snapshot = status.read().await.clone();
    snapshot
}

async fn run_device_loop(
    app: AppHandle,
    device_id: String,
    status: std::sync::Arc<RwLock<DeviceStatus>>,
    runtime: DeviceRuntime,
    mut event_loop: DeviceEventLoop,
) {
    let mut backoff = 1_u64;
    loop {
        tokio::select! {
            _ = runtime.cancel.cancelled() => {
                graceful_disconnect(&runtime.client, &mut event_loop).await;
                if !runtime.suppress_stop_event.load(Ordering::Relaxed) {
                    set_device_state(&app, &status, "stopped", None).await;
                }
                runtime.shutdown.send_replace(true);
                return;
            }
            event = event_loop.poll() => match event {
                Ok(event) => {
                    backoff = 1;
                    process_device_event(&app, &device_id, &status, &runtime, event).await;
                }
                Err(error) => {
                    set_device_state(&app, &status, "disconnected", Some(error.to_string())).await;
                    log(&app, "warning", format!("{device_id} 连接中断，{backoff} 秒后重试。"));
                    tokio::select! {
                        _ = runtime.cancel.cancelled() => {
                            graceful_disconnect(&runtime.client, &mut event_loop).await;
                            if !runtime.suppress_stop_event.load(Ordering::Relaxed) {
                                set_device_state(&app, &status, "stopped", None).await;
                            }
                            runtime.shutdown.send_replace(true);
                            return;
                        }
                        _ = tokio::time::sleep(Duration::from_secs(backoff)) => {}
                    }
                    backoff = (backoff * 2).min(30);
                }
            }
        }
    }
}

async fn process_device_event(
    app: &AppHandle,
    device_id: &str,
    status: &std::sync::Arc<RwLock<DeviceStatus>>,
    runtime: &DeviceRuntime,
    event: DeviceEvent,
) {
    match event {
        DeviceEvent::V4(V4Event::Incoming(V4Packet::ConnAck(_)))
        | DeviceEvent::V5(V5Event::Incoming(V5Packet::ConnAck(_))) => {
            set_device_state(app, status, "connected", None).await;
            log(app, "success", format!("{device_id} 已连接。"));
        }
        DeviceEvent::V4(V4Event::Outgoing(Outgoing::Publish(0)))
        | DeviceEvent::V5(V5Event::Outgoing(Outgoing::Publish(0))) => {
            if let Some(message) = runtime.outgoing.lock().await.pop_front() {
                emit_result(app, &message, "sent_unconfirmed", None);
                update_counters_for_status(app, status, true).await;
            }
        }
        DeviceEvent::V4(V4Event::Outgoing(Outgoing::Publish(packet_id)))
        | DeviceEvent::V5(V5Event::Outgoing(Outgoing::Publish(packet_id))) => {
            if let Some(message) = runtime.outgoing.lock().await.pop_front() {
                runtime.pending.lock().await.insert(packet_id, message);
            }
        }
        DeviceEvent::V4(V4Event::Incoming(V4Packet::PubAck(ack))) => {
            let ok = true;
            finish_pending(app, status, runtime, ack.pkid, ok, None).await;
        }
        DeviceEvent::V4(V4Event::Incoming(V4Packet::PubComp(ack))) => {
            finish_pending(app, status, runtime, ack.pkid, true, None).await;
        }
        DeviceEvent::V5(V5Event::Incoming(V5Packet::PubAck(ack))) => {
            let ok = ack.reason == rumqttc::v5::mqttbytes::v5::PubAckReason::Success
                || ack.reason == rumqttc::v5::mqttbytes::v5::PubAckReason::NoMatchingSubscribers;
            let error = (!ok).then(|| format!("Broker 拒绝消息：{:?}", ack.reason));
            finish_pending(app, status, runtime, ack.pkid, ok, error).await;
        }
        DeviceEvent::V5(V5Event::Incoming(V5Packet::PubRec(ack))) => {
            let ok = ack.reason == rumqttc::v5::mqttbytes::v5::PubRecReason::Success
                || ack.reason == rumqttc::v5::mqttbytes::v5::PubRecReason::NoMatchingSubscribers;
            if !ok {
                finish_pending(
                    app,
                    status,
                    runtime,
                    ack.pkid,
                    false,
                    Some(format!("Broker 拒绝 QoS 2 消息：{:?}", ack.reason)),
                )
                .await;
            }
        }
        DeviceEvent::V5(V5Event::Incoming(V5Packet::PubComp(ack))) => {
            let ok = ack.reason == rumqttc::v5::mqttbytes::v5::PubCompReason::Success;
            let error = (!ok).then(|| format!("Broker 未完成 QoS 2 确认：{:?}", ack.reason));
            finish_pending(app, status, runtime, ack.pkid, ok, error).await;
        }
        DeviceEvent::V4(V4Event::Incoming(V4Packet::Publish(message))) => {
            let _ = app.emit(
                "inbound-message",
                make_message_entry(
                    "in",
                    message.topic,
                    message.payload.as_ref(),
                    message.qos as u8,
                    message.retain,
                    None,
                    Some(device_id.to_string()),
                ),
            );
        }
        DeviceEvent::V5(V5Event::Incoming(V5Packet::Publish(message))) => {
            let properties = message.properties.unwrap_or_default();
            let mut mapped = Vec::new();
            if let Some(expiry) = properties.message_expiry_interval {
                mapped.push(("messageExpiryInterval".to_string(), expiry.to_string()));
            }
            if let Some(indicator) = properties.payload_format_indicator {
                mapped.push(("payloadFormatIndicator".to_string(), indicator.to_string()));
            }
            if let Some(response_topic) = properties.response_topic {
                mapped.push(("responseTopic".to_string(), response_topic));
            }
            if let Some(correlation_data) = properties.correlation_data {
                mapped.push((
                    "correlationDataBase64".to_string(),
                    base64::engine::general_purpose::STANDARD.encode(correlation_data),
                ));
            }
            if let Some(content_type) = properties.content_type {
                mapped.push(("contentType".to_string(), content_type));
            }
            mapped.extend(properties.user_properties);
            let _ = app.emit(
                "inbound-message",
                make_message_entry(
                    "in",
                    String::from_utf8_lossy(&message.topic).to_string(),
                    message.payload.as_ref(),
                    message.qos as u8,
                    message.retain,
                    Some(mapped),
                    Some(device_id.to_string()),
                ),
            );
        }
        _ => {}
    }
}

async fn finish_pending(
    app: &AppHandle,
    status: &std::sync::Arc<RwLock<DeviceStatus>>,
    runtime: &DeviceRuntime,
    packet_id: u16,
    succeeded: bool,
    error: Option<String>,
) {
    if let Some(message) = runtime.pending.lock().await.remove(&packet_id) {
        let result_status = if succeeded { "confirmed" } else { "failed" };
        emit_result(app, &message, result_status, error);
        update_counters_for_status(app, status, succeeded).await;
    }
}

async fn publish_one(client: &DeviceClient, message: &PublishRequest) -> Result<(), String> {
    let qos = match message.options.qos {
        0 => QoS::AtMostOnce,
        1 => QoS::AtLeastOnce,
        2 => QoS::ExactlyOnce,
        _ => return Err("无效的 QoS 值。".to_string()),
    };
    match client {
        DeviceClient::V4(client) => client
            .publish(
                &message.topic,
                qos,
                message.options.retain,
                message.payload.clone(),
            )
            .await
            .map_err(|error| error.to_string()),
        DeviceClient::V5(client) => client
            .publish_with_properties(
                &message.topic,
                match message.options.qos {
                    0 => rumqttc::v5::mqttbytes::QoS::AtMostOnce,
                    1 => rumqttc::v5::mqttbytes::QoS::AtLeastOnce,
                    2 => rumqttc::v5::mqttbytes::QoS::ExactlyOnce,
                    _ => return Err("无效的 QoS 值。".to_string()),
                },
                message.options.retain,
                message.payload.clone(),
                make_properties(&message.options)?,
            )
            .await
            .map_err(|error| error.to_string()),
    }
}

fn make_properties(options: &PublishOptions) -> Result<PublishProperties, String> {
    let correlation_data = options
        .correlation_data_base64
        .as_deref()
        .filter(|value| !value.is_empty())
        .map(|value| {
            base64::engine::general_purpose::STANDARD
                .decode(value)
                .map(Into::into)
                .map_err(|error| format!("Correlation Data 必须是有效的 Base64：{error}"))
        })
        .transpose()?;
    Ok(PublishProperties {
        message_expiry_interval: options.message_expiry_seconds,
        response_topic: options
            .response_topic
            .clone()
            .filter(|value| !value.is_empty()),
        correlation_data,
        content_type: options
            .content_type
            .clone()
            .filter(|value| !value.is_empty()),
        user_properties: options.user_properties.clone(),
        ..PublishProperties::default()
    })
}

fn make_client(
    connection: &BrokerConnection,
    client_id: &str,
) -> Result<(DeviceClient, DeviceEventLoop), String> {
    let transport = make_transport(connection)?;
    match connection.mqtt_version.as_str() {
        "3.1.1" => {
            let mut options = V4Options::new(client_id, &connection.host, connection.port);
            options.set_keep_alive(Duration::from_secs(30));
            if let Some(username) = &connection.username {
                options.set_credentials(username, connection.password.clone().unwrap_or_default());
            }
            options.set_transport(transport);
            let (client, event_loop) = V4Client::new(options, 128);
            Ok((DeviceClient::V4(client), DeviceEventLoop::V4(event_loop)))
        }
        "5.0" => {
            let mut options = V5Options::new(client_id, &connection.host, connection.port);
            options.set_keep_alive(Duration::from_secs(30));
            if let Some(username) = &connection.username {
                options.set_credentials(username, connection.password.clone().unwrap_or_default());
            }
            options.set_transport(transport);
            options.set_clean_start(connection.session_expiry_seconds == 0);
            let mut properties = ConnectProperties::default();
            properties.session_expiry_interval = Some(connection.session_expiry_seconds);
            options.set_connect_properties(properties);
            let (client, event_loop) = V5Client::new(options, 128);
            Ok((DeviceClient::V5(client), DeviceEventLoop::V5(event_loop)))
        }
        _ => Err("MQTT 版本必须是 3.1.1 或 5.0。".to_string()),
    }
}

fn make_transport(connection: &BrokerConnection) -> Result<Transport, String> {
    if !connection.use_tls {
        return Ok(Transport::tcp());
    }
    if let Some(path) = connection
        .ca_cert_path
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        let certificate = fs::read(path).map_err(|error| format!("无法读取 CA 证书：{error}"))?;
        let certificates =
            rustls_pemfile::certs(&mut std::io::BufReader::new(certificate.as_slice()))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("CA 证书 PEM 格式无效：{error}"))?;
        if certificates.is_empty() {
            return Err("CA 证书文件中没有有效的 PEM 证书。".to_string());
        }
        return Ok(Transport::tls(certificate, None, None));
    }
    Ok(Transport::tls_with_default_config())
}

async fn stop_all_devices(service: &MqttService, suppress_status: bool) {
    let devices = std::mem::take(&mut *service.devices.lock().await);
    let mut shutdown_waiters = Vec::new();
    for entry in devices.into_values() {
        if let Some(runtime) = entry.runtime {
            shutdown_waiters.push(runtime.shutdown.subscribe());
            if suppress_status {
                runtime.suppress_stop_event.store(true, Ordering::Relaxed);
            }
            runtime.cancel.cancel();
        }
    }
    for mut shutdown in shutdown_waiters {
        let _ = tokio::time::timeout(Duration::from_secs(2), shutdown.changed()).await;
    }
}

async fn stop_monitor_inner(service: &MqttService) {
    if let Some(monitor) = service.monitor.lock().await.take() {
        monitor.cancel.cancel();
    }
}

fn validate_connection(connection: &BrokerConnection) -> Result<(), String> {
    if connection.host.trim().is_empty() {
        return Err("请填写 MQTT Broker 地址。".to_string());
    }
    if connection.port == 0 {
        return Err("端口号必须在 1 到 65535 之间。".to_string());
    }
    if !["3.1.1", "5.0"].contains(&connection.mqtt_version.as_str()) {
        return Err("请选择 MQTT 3.1.1 或 MQTT 5.0。".to_string());
    }
    Ok(())
}

async fn update_counters(app: &AppHandle, service: &MqttService, device_id: &str, success: bool) {
    if let Some(entry) = service.devices.lock().await.get(device_id) {
        update_counters_for_status(app, &entry.status, success).await;
    }
}

async fn update_counters_for_status(
    app: &AppHandle,
    status: &std::sync::Arc<RwLock<DeviceStatus>>,
    success: bool,
) {
    let snapshot = {
        let mut current = status.write().await;
        if success {
            current.success_count += 1;
        } else {
            current.failure_count += 1;
        }
        current.clone()
    };
    let _ = app.emit("device-status", snapshot);
}

async fn set_device_state(
    app: &AppHandle,
    status: &std::sync::Arc<RwLock<DeviceStatus>>,
    next: &str,
    error: Option<String>,
) {
    {
        let mut current = status.write().await;
        current.status = next.to_string();
        current.error = error;
    }
    emit_device_status(app, status).await;
}

async fn emit_device_status(app: &AppHandle, status: &std::sync::Arc<RwLock<DeviceStatus>>) {
    let snapshot = status.read().await.clone();
    let _ = app.emit("device-status", snapshot);
}

fn emit_result(app: &AppHandle, request: &PublishRequest, status: &str, error: Option<String>) {
    let result = PublishResult {
        device_id: request.device_id.clone(),
        topic: request.topic.clone(),
        status: status.to_string(),
        error,
        timestamp: Utc::now().to_rfc3339(),
        payload_preview: request.payload_preview.clone(),
    };
    let _ = app.emit("publish-result", result);
    if status == "confirmed" || status == "sent_unconfirmed" {
        let mut entry = make_message_entry(
            "out",
            request.topic.clone(),
            &request.payload,
            request.options.qos,
            request.options.retain,
            None,
            Some(request.device_id.clone()),
        );
        entry.payload_format = request.payload_format.clone();
        entry.payload_preview = request.payload_preview.clone();
        let _ = app.emit("published-message", entry);
    }
}

fn make_message_entry(
    direction: &str,
    topic: String,
    payload: &[u8],
    qos: u8,
    retain: bool,
    properties: Option<Vec<(String, String)>>,
    device_id: Option<String>,
) -> MessageEntry {
    let text_preview = String::from_utf8(payload.to_vec())
        .map(|text| text.chars().take(320).collect::<String>())
        .unwrap_or_else(|_| format!("{} bytes", payload.len()));
    MessageEntry {
        id: Uuid::new_v4().to_string(),
        direction: direction.to_string(),
        topic,
        timestamp: Utc::now().to_rfc3339(),
        qos,
        retain,
        payload_format: "auto".to_string(),
        payload_preview: text_preview,
        payload_hex: hex::encode(payload),
        device_id,
        properties: properties.unwrap_or_default(),
    }
}

fn emit_log(app: &AppHandle, level: &str, message: String) {
    let entry = SystemLogEntry {
        id: Uuid::new_v4().to_string(),
        timestamp: Utc::now().to_rfc3339(),
        level: level.to_string(),
        message,
    };
    let _ = app.emit("system-log", entry);
}

fn log(app: &AppHandle, level: &str, message: String) {
    emit_log(app, level, message);
}

async fn remove_queued(
    queue: &std::sync::Arc<Mutex<VecDeque<PublishRequest>>>,
    request: &PublishRequest,
) {
    let mut queue = queue.lock().await;
    if let Some(index) = queue.iter().position(|entry| {
        entry.device_id == request.device_id
            && entry.timestamp == request.timestamp
            && entry.topic == request.topic
    }) {
        queue.remove(index);
    }
}

fn has_mqtt5_properties(options: &PublishOptions) -> bool {
    options.message_expiry_seconds.is_some()
        || options
            .response_topic
            .as_deref()
            .is_some_and(|value| !value.is_empty())
        || options
            .correlation_data_base64
            .as_deref()
            .is_some_and(|value| !value.is_empty())
        || options
            .content_type
            .as_deref()
            .is_some_and(|value| !value.is_empty())
        || !options.user_properties.is_empty()
}

async fn graceful_disconnect(client: &DeviceClient, event_loop: &mut DeviceEventLoop) {
    if client.disconnect().await.is_err() {
        return;
    }
    let flush = async {
        loop {
            match event_loop.poll().await {
                Ok(DeviceEvent::V4(V4Event::Outgoing(Outgoing::Disconnect)))
                | Ok(DeviceEvent::V5(V5Event::Outgoing(Outgoing::Disconnect))) => return,
                Ok(_) => {}
                Err(_) => return,
            }
        }
    };
    let _ = tokio::time::timeout(Duration::from_secs(1), flush).await;
}

fn monitor_message(event: DeviceEvent) -> Option<MessageEntry> {
    match event {
        DeviceEvent::V4(V4Event::Incoming(V4Packet::Publish(message))) => Some(make_message_entry(
            "in",
            message.topic,
            message.payload.as_ref(),
            message.qos as u8,
            message.retain,
            None,
            None,
        )),
        DeviceEvent::V5(V5Event::Incoming(V5Packet::Publish(message))) => {
            let properties = message.properties.unwrap_or_default();
            let mut mapped = Vec::new();
            if let Some(expiry) = properties.message_expiry_interval {
                mapped.push(("messageExpiryInterval".to_string(), expiry.to_string()));
            }
            if let Some(indicator) = properties.payload_format_indicator {
                mapped.push(("payloadFormatIndicator".to_string(), indicator.to_string()));
            }
            if let Some(response_topic) = properties.response_topic {
                mapped.push(("responseTopic".to_string(), response_topic));
            }
            if let Some(correlation_data) = properties.correlation_data {
                mapped.push((
                    "correlationDataBase64".to_string(),
                    base64::engine::general_purpose::STANDARD.encode(correlation_data),
                ));
            }
            if let Some(content_type) = properties.content_type {
                mapped.push(("contentType".to_string(), content_type));
            }
            mapped.extend(properties.user_properties);
            Some(make_message_entry(
                "in",
                String::from_utf8_lossy(&message.topic).to_string(),
                message.payload.as_ref(),
                message.qos as u8,
                message.retain,
                Some(mapped),
                None,
            ))
        }
        _ => None,
    }
}

impl DeviceEventLoop {
    async fn poll(&mut self) -> Result<DeviceEvent, String> {
        match self {
            Self::V4(event_loop) => event_loop
                .poll()
                .await
                .map(DeviceEvent::V4)
                .map_err(|error| error.to_string()),
            Self::V5(event_loop) => event_loop
                .poll()
                .await
                .map(DeviceEvent::V5)
                .map_err(|error| error.to_string()),
        }
    }
}

impl DeviceClient {
    async fn disconnect(&self) -> Result<(), String> {
        match self {
            Self::V4(client) => client.disconnect().await.map_err(|error| error.to_string()),
            Self::V5(client) => client.disconnect().await.map_err(|error| error.to_string()),
        }
    }
}
