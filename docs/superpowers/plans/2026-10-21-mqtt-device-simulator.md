# MQTT Device Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a Windows desktop workbench that simulates IoT devices publishing JSON or Protobuf messages through MQTT.

**Architecture:** Vue owns the workbench, profiles, payload editing, protobufjs schema processing, and scheduled-send controls. Tauri commands cross into a Rust/Tokio service that manages one rumqttc client per virtual device and a separate monitor client; Tauri events stream state and messages back to the UI. Versioned profile/schema data is stored under the application data directory and excludes credentials.

**Tech Stack:** Tauri 2, Vue 3 Composition API, TypeScript, Vite, Rust, Tokio, rumqttc, serde, protobufjs.

**Spec:** `docs/superpowers/specs/2026-10-21-mqtt-device-simulator-design.md`

## Global Constraints

- Target Windows x64 and package an NSIS installer.
- Support MQTT 3.1.1 and MQTT 5.0 over TCP, optional TLS with system trust or a selected CA certificate, and shared username/password credentials for a device batch.
- Support up to 100 virtual devices, each with its own MQTT connection and unique Client ID.
- Support JSON and self-contained proto3 schemas with scalar, enum, nested, repeated, and bytes fields; external `.proto` imports are out of scope.
- Store profiles, scenarios, and schemas as versioned local JSON; never persist passwords or message history.
- Keep the message/log view in memory with a maximum of 200 entries and redact credentials from logs.
- Do not queue publish samples while a device is offline; resume on a later interval after reconnect.

## Review Focus

- Invalid JSON and malformed numeric-range tokens must be rejected before publish with a useful field/editor error (Task 3, payload builder manual check).
- Invalid proto3 syntax, unknown message types, and invalid bytes input must produce a recoverable validation error while valid nested/repeated/enum data encodes (Task 3, schema editor manual check).
- Partial broker failures, retry, capped reconnect, and stopping during reconnect must leave other device sessions usable and stop all schedulers (Task 2, lifecycle manual check).
- Invalid TLS CA files and MQTT-version-specific options must surface a useful error; MQTT 3.1.1 must not receive MQTT 5 properties (Tasks 2 and 4, connection/publish manual check).
- A scheduled count must apply per device even when one device disconnects or receives a publish failure; monitor payloads must remain inspectable when protobuf decoding fails (Task 4, workbench manual check).

## File Map

- `package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`: Vue/Vite app setup and build scripts.
- `src-tauri/Cargo.toml`, `build.rs`, `tauri.conf.json`, `capabilities/default.json`: Rust dependencies, Tauri commands, and Windows bundling.
- `src-tauri/src/models.rs`: Serde request, persisted-data, and event types shared by Rust commands.
- `src-tauri/src/storage.rs`: versioned application-data read/write, excluding secrets and message history.
- `src-tauri/src/mqtt.rs`: device-session lifecycle, monitor session, reconnect, publishing, and event emission.
- `src-tauri/src/lib.rs`: Tauri builder, managed state, and command registration.
- `src/types.ts`: TypeScript mirrors of command and event payloads.
- `src/lib/tauri.ts`: typed command/event wrappers.
- `src/lib/payload.ts`: JSON token resolution and protobufjs parse/encode/decode helpers.
- `src/composables/useSimulator.ts`: workbench state, event listeners, and scheduler lifecycle.
- `src/components/*`: focused broker, payload, publish-control, and message/log panels.
- `src/App.vue`, `src/main.ts`, `src/styles.css`: three-column Chinese workbench and application styling.

---

### Task 1: Scaffold the Tauri/Vue app and persistent workspace types

**Files:**
- Create: `package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`
- Create: `src/main.ts`, `src/types.ts`
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/models.rs`, `src-tauri/src/storage.rs`

**Interfaces:**
- Produces `BrokerProfile`, `DeviceBatch`, `PublishOptions`, `WorkspaceData`, `DeviceStatus`, `PublishRequest`, `MessageEntry`, and `SystemLogEntry` types in Rust and TypeScript with matching serialized field names.
- Produces Tauri commands `load_workspace() -> Result<WorkspaceData, String>` and `save_workspace(data: WorkspaceData) -> Result<(), String>`; `WorkspaceData` has no password field and has a schema version.
- Produces a Tauri 2 app with `dev` and `build` scripts and an NSIS target.

- [x] Create the Vue/Vite and Tauri 2 manifests with the Windows window dimensions and NSIS bundle target from the approved workbench design.
- [x] Define matching serde/TypeScript data contracts for broker, device batch, publish options, workspace profiles/schemas, device states, publish results, received messages, and logs.
- [x] Implement versioned application-data load/save commands; default a missing workspace to an empty profile/schema list and reject unsupported future schema versions without overwriting them.
- [x] Confirm frontend and Rust dependency resolution with `npm install` and `cargo check`.

### Task 2: Implement MQTT device and monitor lifecycle in Rust

**Files:**
- Create: `src-tauri/src/mqtt.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/models.rs`

**Interfaces:**
- Produces `start_batch(connection: BrokerConnection, batch: DeviceBatch) -> Result<Vec<DeviceStatus>, String>`, `retry_device(device_id: String) -> Result<DeviceStatus, String>`, `stop_batch() -> Result<(), String>`, and `publish_messages(messages: Vec<PublishRequest>) -> Result<(), String>` commands.
- Produces monitor commands `start_monitor(connection: BrokerConnection, topic_filters: Vec<String>) -> Result<(), String>` and `stop_monitor() -> Result<(), String>`.
- Emits `device-status`, `publish-result`, `inbound-message`, and `system-log` events matching the Rust and TypeScript payload types.
- Stores connection credentials and live MQTT clients only in managed process state; persisted workspace data remains secret-free.

- [x] Add rumqttc/Tokio session management with one unique client ID and event loop per device, partial-start behavior, individual retry, clean stop, and reconnect backoff capped at 30 seconds.
- [x] Configure MQTT 3.1.1/5.0, shared credentials, TLS system trust or selected CA, QoS, Retain, MQTT 5 session expiry, and supported MQTT 5 publish properties.
- [x] Correlate publish attempts with QoS acknowledgements and emit unconfirmed status for QoS 0; emit monitor messages and redact secrets from all log/error paths.
- [x] Confirm Rust command and event code compiles with `cargo check`.

### Task 3: Implement JSON and Protobuf payload processing

**Files:**
- Create: `src/lib/payload.ts`
- Modify: `package.json`, `src/types.ts`

**Interfaces:**
- Produces `resolveJsonTemplate(template: string, values: { deviceId: string; clientId: string; timestamp: string }): unknown`, which resolves `{{deviceId}}`, `{{clientId}}`, `{{timestamp}}`, `{{randomInt:min:max}}`, and `{{randomFloat:min:max}}`, then validates JSON.
- Produces `parseProtoSchema(source: string): protobuf.Root`, `getMessageFields(root: protobuf.Root, typeName: string)`, `encodeProtoMessage(root, typeName, value): Uint8Array`, and `decodeProtoMessage(root, typeName, bytes): unknown` using protobufjs.
- Bytes accept Hex or Base64; numeric range values include both endpoints; all validation errors are returned in a form the editor can display.

- [x] Add protobufjs and the JSON token resolver, escaping string substitutions while keeping numeric-range tokens numeric.
- [x] Add schema parse, message selection, generated field metadata, encode, decode, and Hex/Base64 conversion helpers.
- [x] Confirm production TypeScript build resolves both JSON and protobuf payload modules with `npm run build`.

### Task 4: Build the Chinese workbench and connect it to Tauri

**Files:**
- Create: `src/lib/tauri.ts`, `src/composables/useSimulator.ts`
- Create: `src/components/BrokerPanel.vue`, `src/components/PayloadEditor.vue`, `src/components/PublishPanel.vue`, `src/components/ActivityPanel.vue`
- Create: `src/App.vue`, `src/styles.css`

**Interfaces:**
- `useSimulator()` exposes reactive workspace, connection state, per-device state/counters, current format/topic/template/schema, incoming/outgoing activity, logs, and `connect`, `retry`, `stop`, `publishOnce`, `startSchedule`, `stopSchedule`, `startMonitor`, and `stopMonitor` actions.
- The top-level view uses a left broker/device column, center JSON/Protobuf editor, right publish controls, and bottom published/received/log tabs.
- The scheduler evaluates payloads per device and attempt, counts scheduled attempts per device, pauses disconnected devices without queuing catch-up samples, and stops cleanly.

- [x] Build the three-column workbench with Chinese labels, profile selection, connection/device status, format switching, schema import/edit/add/validate/save, and generated protobuf fields.
- [x] Add QoS/Retain and MQTT 5 publish property controls, manual and periodic publishing, batch counters, monitor subscriptions, and activity views capped at 200 in-memory entries.
- [x] Wire all buttons and reactive state through typed Tauri commands/events; keep the password only in a session ref and exclude it from `WorkspaceData` saves.
- [x] Confirm frontend type-check and production bundle with `npm run build`.

### Task 5: Document startup and perform acceptance-oriented review

**Files:**
- Create: `README.md`
- Modify: Tauri/package configuration only if build output reveals a packaging issue.

**Interfaces:**
- Documents the Windows prerequisites, development startup command, NSIS bundle command, supported scope, and manual acceptance scenarios from the approved spec.

- [x] Document setup and use, including MQTT 3.1.1/5.0, JSON/Protobuf editing, TLS, and the 100-device ceiling.
- [x] Run `npm run build` and `cargo check`; resolve implementation and configuration errors found in their output.
- [x] Review the final diff against the approved spec and record intentionally deferred scope in the README.
