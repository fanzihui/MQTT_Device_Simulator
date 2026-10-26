# 发布模拟器更新

桌面版会在每次启动时检查 GitHub 最新 Release。发现新版本后，模拟器会显示更新提示；用户确认后下载签名安装包，安装完成时由 Windows 安装程序重新启动模拟器。

发布新版本时：

1. 将 `package.json`、`src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml` 中的版本号改成同一个版本，例如 `0.2.0`。
2. 提交并推送版本改动。
3. 推送对应标签，例如 `v0.2.0`。`.github/workflows/release.yml` 会构建 Windows 安装包并发布 `latest.json` 和签名文件。
4. 在 GitHub 仓库 Secrets 中配置 `TAURI_SIGNING_PRIVATE_KEY`；若密钥有密码，再配置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。签名私钥必须与 `src-tauri/tauri.conf.json` 中的 updater 公钥配对。

Release 工作流会验证标签与三个版本号一致。当前 GitHub 地址还没有可读取的 `latest.json` 时，启动检查会失败并继续正常打开模拟器；首个签名 Release 发布后即可检查到更新。
