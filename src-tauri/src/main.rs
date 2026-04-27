// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

#[tauri::command]
fn run_command(command: String) -> String {
    match std::process::Command::new("sh")
        .arg("-c")
        .arg(&command)
        .output()
    {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.is_empty() {
                format!("{}\nSTDERR: {}", stdout, stderr)
            } else {
                stdout.to_string()
            }
        }
        Err(e) => format!("Error: {}", e),
    }
}

#[tauri::command]
fn read_file(path: String) -> String {
    let expanded = shellexpand::tilde(&path);
    match std::fs::read_to_string(expanded.as_ref()) {
        Ok(content) => {
            if content.len() > 10000 {
                format!("{}...(truncated)", &content[..10000])
            } else {
                content
            }
        }
        Err(e) => format!("Error: {}", e),
    }
}

#[tauri::command]
fn write_file(path: String, content: String) -> String {
    let expanded = shellexpand::tilde(&path);
    let p = std::path::Path::new(expanded.as_ref());
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::write(p, &content) {
        Ok(_) => format!("Wrote {} bytes to {}", content.len(), path),
        Err(e) => format!("Error: {}", e),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![run_command, read_file, write_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
