# 发布模拟器更新

桌面版会在每次启动时检查 GitHub 最新 Release。发现新版本后，模拟器会显示更新提示；用户确认后下载签名安装包，安装完成时由 Windows 安装程序重新启动模拟器。

Tauri 配置中的 `bundle.createUpdaterArtifacts: true` 会让构建生成带签名的 NSIS 更新包。单独运行本地 `pnpm tauri build` 不会生成 GitHub 清单 `latest.json`；该清单由 GitHub Release 工作流中的 `tauri-action` 根据更新包生成并作为 Release 资产上传。工作流结束前会检查 `latest.json` 和签名文件是否都已上传。

发布新版本时：

1. 将 `package.json`、`src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml` 中的版本号改成同一个版本，例如 `0.2.0`。
2. 提交并推送版本改动。
3. 推送对应标签，例如 `v0.2.0`。`.github/workflows/release.yml` 会构建 Windows 安装包和签名更新包，再发布 `latest.json` 与签名文件；缺少任一更新资产时工作流会失败并报告资产列表。
4. 在 GitHub 仓库 Secrets 中配置 `TAURI_SIGNING_PRIVATE_KEY`；若密钥有密码，再配置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。签名私钥必须与 `src-tauri/tauri.conf.json` 中的 updater 公钥配对。

Release 工作流会验证标签与三个版本号一致。已发布但缺少 `latest.json` 的旧 Release 不会被配置修改自动补齐；提交修复后需重新运行对应标签的 Release 工作流，或随下一个版本重新发布。更新清单暂时不可用时，启动检查失败不会阻止模拟器正常打开。
