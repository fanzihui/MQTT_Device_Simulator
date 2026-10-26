# MQTT 设备模拟器实现计划

> **面向后续实现者：** 本计划记录已完成实现、待验收事项和下一阶段。自动更新和 A 版图标已接入代码，Release 与真实 Broker 的 Windows 端到端验收尚未完成。

**目标：** 提供一个可配置 MQTT Broker、模拟最多 100 台虚拟设备、编辑和发布 JSON/Protobuf 载荷、监视消息并按需向 AI 客户端开放 MCP 的 Windows 桌面工作台。

**架构：** Vue 负责工作台、Schema/载荷编辑和界面状态；Tauri 命令连接前端与 Rust 服务。Rust/Tokio/rumqttc 管理 MQTT 设备和监视器，Rust 本机 HTTP 服务实现 MCP 并把允许的工具调用交回 Vue 当前工作台。

**技术栈：** Tauri 2、Vue 3 Composition API、TypeScript、Vite、Rust、Tokio、rumqttc、Axum、protobufjs。

**规格：** spec.md

**当前状态（2026-10-26）：** 前端生产构建、Rust 编译检查和 pnpm 9.15.5 冻结锁安装均通过。浏览器预览截图已保存到 `output/playwright/project-docs/`。GitHub `latest.json` 当前返回 404；已启用 Tauri 更新签名产物，并在 Release 工作流加入资产检查，需重新运行发布工作流或发布新版本后验收。发现 Tauri `devUrl` 为 `1420`、Vite 开发端口为 `1430`，需在桌面验收前对齐。

## 全局约束

- 目标平台为 Windows 10/11 x64，安装包使用 NSIS。
- 支持 MQTT 3.1.1 和 MQTT 5.0；每批最多 100 台虚拟设备。
- 每台设备有独立 MQTT 会话和唯一 Client ID；同批共享连接配置和凭据。
- 首版支持 TCP 和可选 TLS；默认使用系统信任，允许指定 CA 文件。
- 支持 JSON 与自包含 proto3 Schema；不支持外部 .proto 导入。
- 连接配置、场景和 Schema 可持久化；密码、消息历史不持久化。
- 断线重连退避封顶 30 秒；离线时不排队积压样本；停止时清理发送任务。
- MCP 默认关闭，仅绑定 127.0.0.1:39541/mcp，使用 Bearer 令牌；默认只开放读取权限。
- 自动填充只补空字段，保留已有值。
- 自动更新仅用于 Tauri 桌面版；更新包必须通过配置的 updater 公钥签名校验，GitHub 发布标签与三处版本号一致。
- 不新增未经请求的自动化测试；以用户行为验收，并使用构建与 Rust 检查验证代码状态。

## 文件职责

- **src/App.vue**：顶部导航、工作台和设置页切换、启动时更新检查、更新提示、MCP 工具请求转发。
- **src/components/BrokerPanel.vue**：Broker 配置、虚拟设备批次、连接操作。
- **src/components/ConnectionOverviewPanel.vue**：当前 Broker、协议和在线设备概览。
- **src/components/SubscriptionPanel.vue**：多个监听主题过滤器与独立监视客户端的启停。
- **src/components/PayloadEditor.vue**：JSON/Protobuf 模式、Schema 编辑和字段表单。
- **src/components/PublishPanel.vue**：QoS、Retain、MQTT 5 属性、手动/定时发送控制。
- **src/components/ActivityPanel.vue**：已发布消息、接收消息和系统日志。
- **src/components/SettingsPage.vue**：主题、MCP 服务、令牌、权限和 Codex 配置。
- **src/composables/useSimulator.ts**：工作台状态、Tauri 命令和事件、连接/发送/订阅生命周期。
- **src/composables/useThemePreference.ts**：主题偏好与系统主题监听。
- **src/lib/payload.ts**：JSON 模板解析、Protobuf Schema 处理、字段自动填充、编码解码及 bytes 工具。
- **src/lib/tauri.ts、src/types.ts**：前后端命令封装和共享数据类型。
- **src/styles.css**：工作台布局、折叠状态、主题变量和响应式样式。
- **src-tauri/src/mqtt.rs**：设备会话、监视器、发布、重连与事件。
- **src-tauri/src/mcp.rs**：MCP HTTP 服务、Bearer 鉴权、工具列表、分组授权。
- **src-tauri/src/storage.rs**：版本化本地工作区持久化。
- **src-tauri/src/lib.rs**：Tauri 状态管理与命令注册。
- **src-tauri/tauri.conf.json、src-tauri/capabilities/default.json**：Windows 图标、更新清单、公钥与插件权限。
- **.github/workflows/release.yml、docs/releasing-updates.md**：签名 Release 发布和版本约束。
- **README.md、spec.md、plan.md**：用户文档、产品规格及实现与验收跟踪。

## 验收重点

- JSON 中的转义、数值占位符、未知变量和错误范围要在发布前给出有用错误。
- Protobuf 必须保留非空值，并能处理枚举、bytes、重复消息和嵌套消息；递归结构不可导致无限填充。
- 个别设备连接失败、单设备重试、自动重连及停止操作不得影响其他设备或留下定时任务。
- MQTT 3.1.1 不能收到 MQTT 5 属性；QoS 0 状态应明确为未确认。
- MCP 缺令牌、错误令牌、跨源请求和权限关闭时必须被拒绝；MCP 运行态不得跨应用启动自动开启。

---

### 任务 1：桌面应用基础与持久化

**主要模块：** Tauri/Vite 配置、Rust/TypeScript 类型、工作区存储。

**接口：** Tauri 命令读写版本化工作区；共享类型覆盖连接配置、场景、Schema、设备状态、发布结果、接收消息与日志。持久化数据不包含密码或活动历史。

- [x] 创建 Vue/Vite 与 Tauri 2 桌面入口和 Windows NSIS 配置。
- [x] 定义前后端对应的数据类型与工作区版本。
- [x] 实现应用数据目录中的本地工作区加载与保存。
- [x] 前端构建与 Rust 编译检查已在此前执行。

### 任务 2：MQTT 设备生命周期

**主要模块：** Rust MQTT 服务、Tauri MQTT 命令及事件。

**接口：** 支持启动设备批次、重试单台设备、停止批次、发布消息、启停订阅监视，并向界面推送连接、发送、接收和日志事件。

- [x] 每台设备创建独立 MQTT 客户端、唯一 Client ID 和事件循环。
- [x] 实现 MQTT 3.1.1/5.0、共享认证、TLS/CA、QoS、Retain 和 MQTT 5 属性。
- [x] 实现部分连接失败、单台重试、断线退避重连及停止清理。
- [x] QoS 0 标记未确认；QoS 1/2 依据确认统计发送结果。
- [x] 编译检查已在此前通过；实际 Broker 联机与断线恢复仍列入人工验收。

### 任务 3：JSON 与 Protobuf 载荷处理

**主要模块：** 前端载荷工具与 Protobuf 编辑器。

**接口：** JSON 模板解析后生成可发送的 JSON 值；Protobuf Schema 解析、字段信息提取、编码、解码和 Hex/Base64 bytes 转换由前端封装。

- [x] 实现设备 ID、Client ID、时间戳及整数/小数范围变量。
- [x] 解析自包含 proto3 Schema，支持消息类型、标量、枚举、嵌套、repeated 和 bytes。
- [x] 在发布与接收视图间传递编码后的二进制载荷并提供 Hex 预览。
- [x] 前端生产构建已在此前通过；非法输入的 UI 提示仍需人工验收。

### 任务 4：工作台与视觉优化

**主要模块：** 主工作台、连接/载荷/发布/活动组件和全局样式。

**交互要求：** 顶部导航和选择器易于识别；连接设置与发送控制可收起；载荷编辑和消息活动区在主流程中保持清晰。

- [x] 建立简体中文三列工作台：左侧连接概览/订阅，中间载荷/发送控制，右侧消息记录/载荷详情。
- [x] 依据深色工程工作台概念方向调整视觉层级、配色、间距与控件样式。
- [x] 顶部连接设置对话框及可折叠发送控制。
- [x] 完成 Profile、场景、设备、载荷、发送和监视器操作的前后端连接。
- [x] 前端构建已在此前通过。

### 任务 5：偏好设置与 MCP

**主要模块：** 设置页、主题偏好、Rust MCP 服务和 Vue 工具调用桥接。

**接口：** 设置页读写启用状态、令牌及四类权限；MCP 通过本机 HTTP 暴露工具调用，并将请求通过 Tauri 事件转交给当前工作台处理。

- [x] 增加独立设置页和深色/浅色/系统主题选择。
- [x] 实现仅监听回环地址、Bearer 令牌和应用重启后默认关闭的 MCP 服务。
- [x] 实现读取、连接、仿真、发布四组权限，并默认只开启读取。
- [x] 提供令牌轮换、复制和 Codex 配置示例。
- [x] 前端与 Rust 编译检查此前通过；启停、鉴权和权限拒绝需按任务 8 做桌面端人工验收。

### 任务 6：Protobuf 空字段自动填充

**主要模块：** Protobuf 字段处理与载荷编辑器操作区。

**接口：** 接收当前 Schema、消息类型和字段对象，返回只包含必要填充值的更新对象；不覆盖用户已输入的非空字段。

- [x] Schema 有默认值时优先采用，否则按字段类型生成稳定样例。
- [x] 枚举选首项、repeated 生成一项、嵌套消息递归处理。
- [x] 对递归消息结构设置安全深度/循环边界。
- [x] 在 Protobuf 编辑器提供显式“自动填充”操作；端到端字段保留行为需人工验收。

### 任务 7：中文项目文档

**主要模块：** 根目录 README、产品规格和实现计划。

- [x] README 说明环境、开发、构建、使用、协议能力、安全边界、自动更新和 GitHub 发布。
- [x] README 加入浅色/深色工作台截图及 Mermaid 数据流程图。
- [x] spec.md 记录产品问题、方案、用户故事、更新发布约束和验收标准。
- [x] plan.md 记录模块职责、实现状态、剩余验收与后续路线图。

### 任务 8：目标 Windows 环境人工验收

**范围：** 以用户可见操作验证桌面应用、真实 Broker、Protobuf、主题和 MCP。

- [ ] 在 Windows 桌面端启动应用，建立 MQTT 3.1.1 与 5.0 连接，测试 TLS、批次连接、失败设备重试和停止。
- [ ] 分别验证 JSON/Protobuf 手动发布与定时发布、QoS/Retain、消息接收及 Protobuf 解码。
- [ ] 验证自动填充保留已有值，并覆盖枚举、repeated、嵌套及 Schema 默认值。
- [ ] 切换深色/浅色/系统主题，收起和展开连接设置及发送控制。
- [ ] 验证 MCP 默认关闭、回环监听、Bearer 鉴权、Codex 客户端连接和四类权限开关。
- [ ] 在目标 Windows 环境构建并安装 NSIS 包，确认数据保留与密码/活动记录不持久化。

### 任务 9：A 版品牌图标与自动更新

**主要模块：** Tauri updater 插件、启动检查与提示、Windows 安装包图标、GitHub Release 工作流。

- [x] 用 A 版图标覆盖 Tauri Windows ICO，并在工作台品牌位置显示 A 版标识。
- [x] 桌面启动时检查 GitHub `latest.json`；浏览器预览和更新检查失败不影响主界面。
- [x] 有更新时展示版本和说明，允许稍后或下载并安装；Windows 安装器负责重启。
- [x] 注册 Tauri updater 插件并授予最小必需权限。
- [x] 在 `v*` Release 工作流校验标签与三个版本号一致，并记录签名私钥 Secrets 要求。
- [x] 开启 `bundle.createUpdaterArtifacts`，并让 Release 工作流在上传后确认 `latest.json` 与签名资产存在。
- [ ] 重新发布带更新资产的 Release 后，使用旧版 Windows 安装包完成检查、签名校验、延后、安装和重启验收。

## 下一阶段路线图

### P0：桌面启动与签名 Release 验收

这是开始新增功能前的发布门槛。

1. **统一开发端口。** 将 `src-tauri/tauri.conf.json` 的 `devUrl` 与 `package.json` 中 Vite 实际监听端口统一为 `1430`，然后确认 `pnpm tauri dev` 能启动桌面窗口。
2. **完成 Windows 功能走查。** 使用 Windows 10/11 x64 安装包，人工验证 MQTT 3.1.1/5.0、TLS/CA、批次连接、单设备重试、重连、JSON/Protobuf 发布、QoS、主题监视、主题切换和本地数据恢复。
3. **发布带签名版本。** 确认 GitHub Secrets 与配置公钥配对；三个应用版本号一致；推送匹配的 `vX.Y.Z` 标签；确认工作流通过资产检查且 Release 包含 NSIS 安装包、`.sig` 和 `latest.json`。
4. **完成旧版升级演练。** 从旧版启动；覆盖无更新、网络不可用、有效签名更新、稍后处理、签名无效和更新后自动重启场景。

**P0 完成条件：** Windows 原生开发命令可用；MQTT/MCP 主要流程通过人工验收；签名 Release 可被旧版检查并安全安装；错误签名被拒绝；安装后能重新启动到新版本。

**当前阻塞：** 更新清单地址仍返回 404，直到修复后的工作流重新上传当前标签或新版本的 `latest.json`。更新发布步骤见 [docs/releasing-updates.md](docs/releasing-updates.md)。

### P1：提升联调证据与配置复用

完成 P0 后按实际使用反馈排序，优先评估：

- 导出选中的消息、载荷与相关日志，便于问题复现和跨团队反馈。
- 导入/导出连接配置、模拟方案和 Schema；导出文件明确不包含密码。
- 加强连接诊断，显示最近错误、重连次数和设备级发送结果，并提供可复制的诊断摘要。

每项先补充用户故事和验收标准，再决定是否进入实现；不把此候选清单视作已批准的功能范围。

### P2：扩展协议与规模

根据 P1 使用情况重新评估当前范围之外的能力：多文件 `.proto` 依赖、每设备独立凭据、更高规模压力测试和远程/云同步。每项需要单独确定安全边界、资源上限和验收指标。

此前的本地检查记录为：`npm run build`、`cargo check`、`cargo fmt --check`。本次更新文档并生成工作台截图，没有重新执行构建或 Cargo 检查；真实 Broker、MCP 和更新安装仍待 Windows 桌面人工验收。
