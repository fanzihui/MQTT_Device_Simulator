# MQTT 设备模拟器实现计划

> **面向后续实现者：** 按下列任务顺序复核实现。任务以复选框记录；代码与构建阶段已完成，目标 Windows 环境中的端到端人工验收仍需执行。

**目标：** 提供一个可配置 MQTT Broker、模拟最多 100 台虚拟设备、编辑和发布 JSON/Protobuf 载荷、监视消息并按需向 AI 客户端开放 MCP 的 Windows 桌面工作台。

**架构：** Vue 负责工作台、Schema/载荷编辑和界面状态；Tauri 命令连接前端与 Rust 服务。Rust/Tokio/rumqttc 管理 MQTT 设备和监视器，Rust 本机 HTTP 服务实现 MCP 并把允许的工具调用交回 Vue 当前工作台。

**技术栈：** Tauri 2、Vue 3 Composition API、TypeScript、Vite、Rust、Tokio、rumqttc、Axum、protobufjs。

**规格：** spec.md

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
- 不新增未经请求的自动化测试；以用户行为验收，并使用构建与 Rust 检查验证代码状态。

## 文件职责

- **src/App.vue**：顶部导航、工作台和设置页切换、MCP 工具请求转发。
- **src/components/BrokerPanel.vue**：Broker 配置、虚拟设备批次、连接操作。
- **src/components/PayloadEditor.vue**：JSON/Protobuf 模式、Schema 编辑和字段表单。
- **src/components/PublishPanel.vue**：发布属性、手动/定时发送与订阅控制。
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

- [x] 建立简体中文三列工作台及底部活动视图。
- [x] 依据深色工程工作台概念方向调整视觉层级、配色、间距与控件样式。
- [x] 添加连接设置与发送控制的独立折叠状态。
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

- [x] 将 README 改写为简体中文，包含环境、开发、构建、使用、协议能力和安全边界。
- [x] 在 spec.md 记录问题、方案、用户故事、实现决策、验收标准、测试决策和范围外事项。
- [x] 在 plan.md 记录模块职责、实施任务、复核重点和剩余验收工作。

### 任务 8：目标 Windows 环境人工验收

**范围：** 以用户可见操作验证桌面应用、真实 Broker、Protobuf、主题和 MCP。

- [ ] 在 Windows 桌面端启动应用，建立 MQTT 3.1.1 与 5.0 连接，测试 TLS、批次连接、失败设备重试和停止。
- [ ] 分别验证 JSON/Protobuf 手动发布与定时发布、QoS/Retain、消息接收及 Protobuf 解码。
- [ ] 验证自动填充保留已有值，并覆盖枚举、repeated、嵌套及 Schema 默认值。
- [ ] 切换深色/浅色/系统主题，收起和展开连接设置及发送控制。
- [ ] 验证 MCP 默认关闭、回环监听、Bearer 鉴权、Codex 客户端连接和四类权限开关。
- [ ] 在目标 Windows 环境构建并安装 NSIS 包，确认数据保留与密码/活动记录不持久化。

已知此前通过的本地检查：npm run build、cargo check、cargo fmt --check。本轮仅编辑文档，没有重新运行构建或验收命令。