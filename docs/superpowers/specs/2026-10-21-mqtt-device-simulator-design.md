# MQTT Device Simulator Design

**Date:** 2026-10-21

**Status:** Approved for implementation

**Project:** mqtt-device-simulator

## Goal

Build a Windows desktop tool for developers to simulate IoT devices that publish telemetry to an MQTT broker. Users can configure a device batch, edit JSON or Protobuf payloads, run scheduled publishing, and inspect broker responses and received messages.

The first release targets development integration, not high-volume load testing.

## Confirmed decisions

| Area | Decision |
| --- | --- |
| Desktop stack | Tauri 2, Vue 3, TypeScript, and Vite |
| MQTT engine | Rust backend using rumqttc and Tokio |
| MQTT versions | Select MQTT 3.1.1 or MQTT 5.0 per scenario |
| Transport | MQTT over TCP; optional TLS with system trust or a user-selected CA certificate |
| Authentication | Shared broker username and password for a device batch; password remains in memory for the current app session |
| Device model | Up to 100 virtual devices per batch, each with its own connection and unique Client ID |
| Device configuration | Devices in a batch share a payload schema and template, with unique IDs and dynamic field values |
| Publishing | Manual publish or periodic publish; count applies per device; QoS 0/1/2 and Retain are configurable |
| Receiving | Optional subscriptions use a dedicated monitor client |
| Appearance | Dark by default, with light and system theme options in an independent Settings page |
| MCP | Optional local HTTP MCP service, disabled on launch, loopback-only with Bearer token and grouped tool permissions |
| Payload formats | Editable JSON or Protobuf; Protobuf payloads are encoded binary on the MQTT wire |
| Protobuf schemas | Import, add, edit, validate, and save self-contained proto3 schemas in the app |
| Persistence | Local profiles and schemas; no saved passwords, cloud sync, or persisted message history |
| UI | Simplified Chinese, three-column workbench with a bottom message and log area |
| Windows packaging | x64 NSIS installer |
| Repository | Standalone Git repository in the new project directory |

## Architecture

Vue owns the workbench, profile and scenario editors, JSON editor, Protobuf schema editor, generated field forms, counters, and message viewer. The Protobuf editor uses protobufjs to parse schemas and encode or decode payloads.

The Rust side owns broker connections and simulation lifecycle. A device session manager creates one rumqttc client and Tokio event loop per virtual device. A separate monitor client receives optional subscriptions. All clients in a batch share the selected broker, protocol version, and authentication settings.

Vue invokes typed Tauri commands for connection, start/stop, retry, publish, and subscription actions. Rust emits connection changes, publish results, received messages, and system log entries back to Vue through Tauri events. Protobuf bytes cross the Tauri boundary as byte arrays; JSON is sent as UTF-8.

## Workbench and user flow

The selected layout is a three-column workbench:

- The top bar selects a local profile and shows connection state and MQTT version.
- The left column manages broker details and device batches.
- The center column edits the topic, JSON template, or Protobuf schema and fields.
- The right column configures QoS, Retain, interval, send count, and start/stop controls; it also shows success and failure counters.
- The bottom area switches between published messages, received messages, and system logs.

The main flow is: select a profile, connect to the broker, configure a device batch and payload, set publish options, start the batch, and inspect results. Each device can be retried when its connection fails.

## Device simulation and MQTT behavior

Each virtual device receives a unique device ID and Client ID generated from configurable prefixes and a sequence. JSON and topic templates support {{deviceId}}, {{clientId}}, and {{timestamp}}; timestamps are UTC ISO 8601. JSON numeric range tokens use {{randomInt:min:max}} or {{randomFloat:min:max}} and resolve to numeric JSON values. Protobuf numeric fields expose fixed/range controls in the generated field form. A configured range is sampled for each publish, with the minimum and maximum included.

Starting a batch creates one MQTT client per device. Manual publish sends one message from each connected device. Periodic mode publishes at the same interval for each device, with a per-device count; a blank count means continue until stopped. When a device disconnects, its scheduler pauses and resumes on the next interval after reconnecting. Offline intervals do not accumulate messages. Each scheduled publish attempt consumes one count; publish errors count as failures and are not retried by the application.

For QoS 0, the UI reports the message as sent but unconfirmed because the protocol has no broker acknowledgement. QoS 1 and QoS 2 successes require the corresponding broker acknowledgement. Negative acknowledgements and local publish errors count as failures.

MQTT 3.1.1 and MQTT 5.0 are selectable per scenario. All versions expose QoS 0/1/2 and Retain. MQTT 5.0 additionally exposes Session Expiry on the connection and Message Expiry, Response Topic, Correlation Data, Content Type, and user properties on publishes. MQTT 5-only fields are hidden for MQTT 3.1.1.

The monitor client can subscribe to one or more topic filters using the selected profile. Incoming messages show topic, time, QoS, Retain, payload format, and available MQTT 5 properties. JSON messages are rendered as text. Protobuf messages can be decoded with a selected matching schema; without one, the payload is shown as Hex.

## Protobuf schema editing

Users can import a .proto file or add a schema in the built-in text editor. They can edit and save multiple schema entries locally, validate the source, choose a message type, and edit its fields. Validation and encode errors identify the schema or field location where possible.

The first release supports self-contained proto3 schemas with scalar, enum, nested, repeated, and bytes fields. Bytes fields accept Hex or Base64 input. Schemas with external imports are outside the first release. The MQTT payload contains the encoded Protobuf bytes, while the UI can show both decoded fields and a Hex preview.

The Protobuf field form can fill empty fields with stable examples. Explicit field defaults are preferred; otherwise it selects examples by field type, uses the first enum member, adds one value to repeated fields, and recursively fills nested messages. Existing non-empty values are preserved.

## Application preferences and MCP

The Settings page controls dark, light, or system appearance and the optional local MCP server. The server starts disabled on every application launch, binds only to `127.0.0.1`, and authenticates requests with a generated Bearer token. Codex configuration is displayed as a TOML snippet with an environment variable reference for the token.

MCP tools are authorized by four independent settings: read state, connection control, simulation control, and publish messages. Read state is enabled by default; every write-capable group is disabled by default. MCP control uses the profile and scenario currently selected in the workbench.

## Persistence, security, and recovery

Versioned JSON files under the Tauri application data directory store broker profiles, non-secret connection settings, device scenarios, payload templates, and Protobuf source. Passwords remain in process memory and are cleared when the app exits. Message history is a 200-entry in-memory ring and is not persisted. Logs must redact passwords.

TLS validates the broker certificate using system trust by default and can use a selected CA file. Mutual TLS client certificates are out of scope for the first release.

Connection status and errors are tracked per device. If some initial connections fail, connected devices continue and the failed devices can be retried individually or as a group. Unexpected disconnects trigger automatic reconnect with capped backoff from 1 to 30 seconds. The application does not queue new samples for catch-up while a device is offline; it resumes on the next scheduled interval after reconnection. MQTT-level QoS handling remains the client's responsibility.

## Proposed initial defaults

These are implementation defaults and can be adjusted while reviewing this document:

- MQTT 5.0, one device, QoS 1, Retain off, and TLS off.
- Manual publishing selected initially; periodic mode starts at a 1 second interval and 10 publishes per device.
- Default topic example: sensors/{{deviceId}}/telemetry.

## Scope boundaries

The first release supports Windows x64, up to 100 virtual devices, shared credentials per batch, MQTT 3.1.1 and 5.0, and the schema forms listed above. It does not include high-volume stress testing, per-device credentials, mutual TLS, external .proto imports, cloud sync, saved passwords, or persisted message history.

## Acceptance criteria

1. The app starts in development mode and produces a Windows x64 NSIS installer.
2. A user can connect to MQTT 3.1.1 and MQTT 5.0 brokers over TCP, with optional TLS and username/password authentication.
3. A batch can run up to 100 independent device connections with unique Client IDs, publish manually or periodically, stop cleanly, and report per-device failures.
4. JSON templates resolve device ID, client ID, timestamp, and configured numeric ranges to valid JSON values.
5. Users can import, add, edit, validate, and save Protobuf schemas; select supported message types; send encoded bytes; and inspect decoded and Hex previews.
6. QoS and Retain are applied to publishes; MQTT 5.0 Session Expiry is applied to the connection, and the other MQTT 5.0 properties are applied to publishes.
7. The monitor client can subscribe, show inbound messages, and decode Protobuf payloads when a matching schema is selected.
8. Profiles and schemas survive app restarts, passwords do not, and message history is cleared at exit.
9. Partial initial connection failures, user retry, unexpected disconnect, capped reconnect backoff, and stop behavior match the recovery rules above.

These are manual acceptance checks for the implementation; this design does not add or run automated tests.
