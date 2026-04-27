#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use std::path::Path;

#[tauri::command]
fn run_command(command: String) -> String {
    match std::process::Command::new("sh").arg("-c").arg(&command).output() {
        Ok(o) => {
            let out = String::from_utf8_lossy(&o.stdout);
            let err = String::from_utf8_lossy(&o.stderr);
            if !err.is_empty() { format!("{}\nSTDERR: {}", out, err) } else { out.to_string() }
        }
        Err(e) => format!("Error: {}", e),
    }
}

#[tauri::command]
fn read_file(path: String) -> String {
    let p = shellexpand::tilde(&path);
    match std::fs::read_to_string(p.as_ref()) {
        Ok(c) => if c.len() > 10000 { format!("{}...(truncated)", &c[..10000]) } else { c },
        Err(e) => format!("Error: {}", e),
    }
}

#[tauri::command]
fn write_file(path: String, content: String) -> String {
    let p = shellexpand::tilde(&path);
    let pp = Path::new(p.as_ref());
    if let Some(parent) = pp.parent() { let _ = std::fs::create_dir_all(parent); }
    match std::fs::write(pp, &content) {
        Ok(_) => format!("Wrote {} bytes to {}", content.len(), path),
        Err(e) => format!("Error: {}", e),
    }
}

#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let p = shellexpand::tilde(&path);
    let data = std::fs::read(p.as_ref()).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

#[tauri::command]
fn save_upload(name: String, data: String) -> Result<String, String> {
    let upload_dir = dirs::home_dir().unwrap_or_default().join(".lens").join("uploads");
    std::fs::create_dir_all(&upload_dir).map_err(|e| e.to_string())?;
    let dest = upload_dir.join(&name);
    let bytes = base64::engine::general_purpose::STANDARD.decode(&data).map_err(|e| e.to_string())?;
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn take_screenshot() -> Result<String, String> {
    let out = std::process::Command::new("sh")
        .arg("-c")
        .arg("gdbus call --session --dest org.freedesktop.portal.Desktop --object-path /org/freedesktop/portal/desktop --method org.freedesktop.portal.Screenshot.Screenshot '' '{\"interactive\": <false>}' && sleep 1.5 && ls -t ~/Pictures/Screenshot*.png | head -1")
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    // Get the last line which is the file path
    let path = stdout.lines().last().unwrap_or("").trim();
    if path.is_empty() || !Path::new(path).exists() {
        return Err("Screenshot failed".to_string());
    }
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            run_command, read_file, write_file,
            read_file_base64, save_upload, take_screenshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
