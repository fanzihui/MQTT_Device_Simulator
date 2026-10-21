use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};

use crate::models::WorkspaceData;

const WORKSPACE_VERSION: u32 = 1;

fn workspace_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("workspace.json"))
}

#[tauri::command]
pub fn load_workspace(app: AppHandle) -> Result<WorkspaceData, String> {
    let path = workspace_path(&app)?;
    if !path.exists() {
        return Ok(WorkspaceData::default());
    }

    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let workspace: WorkspaceData =
        serde_json::from_str(&contents).map_err(|error| format!("工作区文件无法读取：{error}"))?;
    if workspace.version > WORKSPACE_VERSION {
        return Err(format!(
            "工作区版本 {} 高于当前支持版本 {}，为保护数据未进行覆盖。",
            workspace.version, WORKSPACE_VERSION
        ));
    }

    Ok(workspace)
}

#[tauri::command]
pub fn save_workspace(app: AppHandle, mut data: WorkspaceData) -> Result<(), String> {
    if data.version > WORKSPACE_VERSION {
        return Err("不支持保存高于当前版本的工作区数据。".to_string());
    }
    data.version = WORKSPACE_VERSION;
    let contents = serde_json::to_string_pretty(&data).map_err(|error| error.to_string())?;
    fs::write(workspace_path(&app)?, contents).map_err(|error| error.to_string())
}
