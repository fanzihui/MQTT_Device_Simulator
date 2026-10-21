# MQTT 设备模拟器

面向 IoT 开发与联调的 Windows 桌面工作台，用于模拟虚拟设备通过 MQTT 发布 JSON 或 Protobuf 遥测数据，并查看订阅消息与运行日志。

应用采用 Tauri 2、Vue 3、TypeScript 和 Rust。浏览器模式用于预览界面；MQTT 连接、设备仿真和 MCP 服务需要在 Tauri 桌面应用中运行。

## 功能概览

- 支持 MQTT 3.1.1 和 MQTT 5.0，可配置 TCP、可选 TLS、用户名和密码。
- 单批最多模拟 100 台设备，每台设备使用独立连接和唯一 Client ID。
- 支持手动发布和定时发布，可配置 QoS 0/1/2、Retain 和每台设备发送次数。
- 支持 JSON 模板变量和随机数范围。
- 支持导入、添加、编辑、校验和保存自包含的 proto3 Schema；支持标量、枚举、嵌套消息、repeated 和 bytes 字段。
- Protobuf 字段表单提供“自动填充”：只补空字段，保留已有值；优先使用 Schema 默认值，否则按字段类型生成样例。
- 可启动独立订阅监视器，查看收到的消息；选择匹配的 Schema 解码 Protobuf，或查看原始 Hex。
- 工作台提供可折叠的连接设置与发送控制；独立设置页支持深色、浅色和跟随系统主题。
- 可选启用本机 MCP HTTP 服务，供 Codex 等 AI 客户端调用；服务默认关闭，支持令牌认证和分类权限。

## 环境要求

- Windows 10 或 Windows 11 x64
- Node.js 20.19 或更高版本与 npm
- Rust stable 和 MSVC 工具链
- Microsoft C++ Build Tools
- WebView2 Runtime（Tauri 所需）

## 开发运行

在项目根目录执行：

~~~powershell
npm install
npm run tauri dev
~~~

仅预览界面可运行 npm run dev。浏览器预览不连接 MQTT，也不启动 MCP 服务。

## 构建 Windows 安装包

~~~powershell
npm run tauri build
~~~

安装包使用 NSIS 格式，输出目录为 src-tauri/target/release/bundle/nsis/。

## 基本使用流程

1. 在工作台选择或新建连接配置，填写 Broker 地址、端口、用户名、密码及可选 TLS CA 文件。
2. 选择或创建模拟场景，并设置 MQTT 版本、设备数量、设备 ID 前缀和 Client ID 前缀。
3. 连接设备批次。设备分别建立连接；失败设备可以单独重试，也可以批量重试。
4. 设置主题模板和载荷格式。JSON 模式编辑模板；Protobuf 模式添加或导入 proto3 Schema、选择消息类型并填写字段。
5. 配置 QoS、Retain 和发送方式。手动发送单轮，或设置间隔与每台设备发送次数后启动定时发送。发送次数留空时持续运行，直到停止。
6. 按需启动订阅监视器，填写一个或多个主题过滤器，在消息与日志面板查看发送结果、收到的数据和系统事件。
7. 连接设置和发送控制可以收起，以便为载荷编辑和活动记录腾出空间；外观及 MCP 配置位于顶部导航的“设置”页。

## JSON 模板

支持以下变量：

- {{deviceId}}：当前虚拟设备 ID
- {{clientId}}：当前 MQTT Client ID
- {{timestamp}}：当前 UTC ISO 8601 时间
- {{randomInt:min:max}}：包含上下界的随机整数
- {{randomFloat:min:max}}：包含边界范围的随机小数

随机数变量应作为 JSON 数值使用，不要在变量外套引号。发布前会解析模板并校验 JSON；未知变量、无效范围或格式错误会返回错误。

示例：

~~~json
{
  "deviceId": "{{deviceId}}",
  "sentAt": "{{timestamp}}",
  "temperature": {{randomFloat:18:30}},
  "battery": {{randomInt:50:100}}
}
~~~

## Protobuf

Schema 编辑器支持自包含的 proto3 定义。外部 .proto 导入暂不支持。bytes 字段可用 Hex 或 base64:<内容> 输入。Protobuf 消息在 MQTT 网络载荷中以编码后的二进制发送；界面提供字段编辑和 Hex 预览。

选择消息类型后，可以使用“自动填充”补齐空字段：

- 有 Schema 默认值时优先使用默认值。
- 否则按字段类型生成稳定样例；字符串使用字段名相关的示例，布尔值使用 false，数值使用固定样例。
- 枚举使用首个枚举值。
- repeated 字段生成一项样例。
- 嵌套消息递归填充。
- 已填写的字段值会保留。

## MQTT 版本与消息监视

MQTT 3.1.1 与 MQTT 5.0 均支持 QoS 0/1/2 和 Retain。MQTT 5.0 还支持连接 Session Expiry，以及消息的 Message Expiry、Response Topic、Correlation Data、Content Type 和用户属性；选择 MQTT 3.1.1 时不显示 MQTT 5 专属选项。

订阅监视使用独立客户端。收到的消息包含主题、时间、QoS、Retain、载荷格式及可用的 MQTT 5 属性。JSON 以文本查看；Protobuf 可选择已保存的匹配 Schema 解码，未解码时可检查 Hex 内容。

QoS 0 没有 Broker 确认，界面将其标记为已发送但未确认。QoS 1/2 根据 Broker 确认结果统计成功或失败。

## 外观与 MCP

设置页支持深色、浅色和跟随 Windows 系统主题。深色为默认主题。

MCP 服务仅在 Tauri 桌面应用运行时可用，默认关闭；启用后仅监听 127.0.0.1:39541/mcp，并要求 Bearer 令牌。每次启动应用时服务都会保持关闭，需要在设置页主动启用。设置页提供端点、令牌、Codex TOML 配置示例及 PowerShell 环境变量命令。

Codex 配置示例：

~~~toml
[mcp_servers.telemetry-studio]
url = "http://127.0.0.1:39541/mcp"
bearer_token_env_var = "TELEMETRY_STUDIO_MCP_TOKEN"
~~~

在启动 Codex 的 PowerShell 会话中设置设置页提供的令牌：

~~~powershell
$env:TELEMETRY_STUDIO_MCP_TOKEN = "<设置页中的令牌>"
~~~

MCP 工具分为四类：

- **读取状态**：查询连接、设备、当前场景和发送计数器。默认开启。
- **连接控制**：连接或断开设备、重试失败设备、启动或停止订阅监视。默认关闭。
- **仿真控制**：启动或停止定时发送。默认关闭。
- **发布消息**：按当前载荷和发布设置立即发送一轮。默认关闭。

MCP 操作使用工作台当前选择的连接配置和模拟场景。浏览器预览不提供 MCP 服务。

## 数据与安全边界

- 连接配置、模拟场景和 Schema 以版本化 JSON 保存在操作系统应用数据目录。
- 密码只保留在当前应用进程中，不写入持久化工作区。
- 发送记录、接收记录和日志只保存在内存中；每类活动记录最多保留 200 条，关闭应用后清空。
- 日志不得记录密码。
- 首版不支持高并发压力测试、每设备独立凭据、双向 TLS 客户端证书、外部 .proto 导入、云同步或持久化消息历史。
- TLS 默认使用系统信任；也可指定 CA 文件。

## 本地构建检查

~~~powershell
npm run build
Set-Location src-tauri
cargo check
cargo fmt --check
~~~