# MQTT 设备模拟器实施计划

> 更新日期：2026-11-05 · 当前版本基线：v1.7.0 · 产品规格见 [spec.md](spec.md)

## 产品目标

提供 Windows 桌面工作台，支持配置 MQTT Broker、运行最多 100 台虚拟设备、编辑与发布 JSON/Protobuf、监听消息，并可选向本机 AI 客户端开放受权限控制的 MCP 服务。

前端使用 Vue 3、TypeScript 和 Vite；Tauri 2 负责桌面桥接；Rust、Tokio、rumqttc 和 Axum 管理 MQTT 生命周期及本机 MCP 服务。

## 当前状态

- 已交付：MQTT 3.1.1/5.0、TCP/TLS、设备批次与重连、JSON/Protobuf、主题订阅、深浅色主题、MCP、签名更新检查与 Windows NSIS 配置。
- 版本元数据：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`package-lock.json` 和 `src-tauri/Cargo.lock` 已对齐到 1.7.0；`pnpm-lock.yaml` 不保存项目版本。
- 数值替换：替换时由 CodeMirror 在自己的文档中核对目标区间，避免编辑器文档与 Vue 模型偏移不同步；尚未做桌面运行验收。
- 密码保存：桌面端保存连接配置或仿真方案时，将密码明文写入本机 `workspace.json`；留空并保存会清除密码。此行为已实现，待重启恢复验收。
- 桌面开发配置仍有待处理项：Vite 使用 1430 端口，Tauri `devUrl` 记录为 1420；在 P0 中先统一为 1430。
- 更新清单：2026-11-05 配置的 `latest.json` 地址返回 HTTP 200；清单内容、版本比较、签名更新和旧安装包升级仍需通过 Tauri 实际验收。2026-10-26 的 404 是历史记录，不代表当前状态。
- 未完成：Windows 桌面、真实 Broker、MCP 和签名更新端到端验收。

## P0：v1.7.0 桌面稳定与发布验收

所有 P0 项通过前，不进入新功能发布。每项记录 Windows 版本、应用版本、操作步骤、结果和可复核证据；失败项需修复并重验。

| 顺序 | 工作 | 完成条件 |
| --- | --- | --- |
| 1 | 对齐 Vite 与 Tauri 开发端口为 1430 | `pnpm tauri dev` 能启动并载入应用窗口 |
| 2 | 构建并安装 Windows x64 NSIS 包 | 安装、启动、退出及已有配置恢复正常 |
| 3 | 验收 Broker 与载荷流程 | MQTT 3.1.1/5.0、TCP/TLS/CA、批次连接、失败重试、断线重连、停止、JSON/Protobuf 手动与定时发送、QoS/Retain、主题接收均符合规格 |
| 4 | 验收 MCP 边界 | 默认关闭、仅回环监听、Bearer 鉴权有效；缺失/错误令牌和未授权工具调用被拒绝；四类权限生效 |
| 5 | 验收密码与本地工作区 | 保存配置后重启仍显示已保存密码；留空并保存会清除；删除最后一个关联方案后连接配置及密码一并移除；日志无密码 |
| 6 | 验收签名更新 | 清单可读且版本有效；NSIS、签名和 `latest.json` 资产齐全；无更新、网络失败、稍后安装、有效/无效签名、旧版升级和安装后重启场景均通过 |

### P0 发布证据

发布记录应注明版本标签与三处主版本字段（package、Tauri、Cargo）一致，GitHub Secrets 与 updater 公钥配对，工作流产物完整。`latest.json` 返回 HTTP 200 只是可访问性检查，不替代签名校验或旧版升级演练。

## P1：联调效率

### P1.1 连接与发送诊断（下一项）

提供设备级状态和发送结果，并可复制诊断摘要。摘要包括应用版本、MQTT 协议、完整 Broker 主机/IP 与端口、设备状态、重连次数、发送统计和最近错误；排除用户名、密码、令牌和载荷。诊断数据只保存在内存、设定上限，应用退出后清空；用户主动复制。建议沿用现有活动记录最多 200 条的上限。

验收：断线、单设备重试和发送失败都能对应到设备及错误；复制摘要包含必要联调信息，且不含用户名、密码、令牌或消息载荷；重启后诊断历史清空。

### P1.2 独立消息模板库

在“消息载荷”工具栏提供模板选择和保存/管理。模板独立于 Broker 与设备场景，每条包含名称、主题模板和 JSON 模板；保存在本机工作区，可新建、改名、删除和套用。

套用前只检查当前主题和 JSON 是否偏离已保存方案；若会覆盖未保存修改，先提供“套用 / 取消”确认。套用只更新当前编辑器中的主题和 JSON，不连接、不发送，也不自动保存仿真方案；用户仍通过现有保存操作保存场景。模板中的动态变量按原文保留。

验收：多条模板在重启后仍可选用；创建、改名、删除和套用均只影响所选模板；有未保存编辑时可取消覆盖；套用后 Broker、设备、发送选项及连接状态不变。

## P2：待使用反馈再评估

目前仅为候选，不构成已批准的版本承诺：连接/场景/Schema 导入导出、消息与日志导出、多文件 `.proto` 依赖、更高设备规模、远程同步。进入实现前需分别补充用户场景、数据边界、资源限制和验收条件。

## 维护范围

- 工作区与前后端类型：`src/types.ts`、`src-tauri/src/models.rs`、`src-tauri/src/storage.rs`。
- 仿真状态和保存流程：`src/composables/useSimulator.ts`。
- 载荷与消息记录：`src/components/PayloadEditor.vue`、`src/components/CodeEditor.vue`、`src/components/ActivityPanel.vue`。
- Broker 与方案界面：`src/components/BrokerPanel.vue`、`src/components/SimulationPlanDialog.vue`。
- 发布和更新：`.github/workflows/release.yml`、`docs/releasing-updates.md`。

本轮未运行构建、自动化测试或 Windows 桌面验收；相关状态仍列为待验证。
