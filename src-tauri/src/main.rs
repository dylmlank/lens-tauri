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

#[tauri::command]
fn search_vault(query: String) -> String {
    let vault = dirs::home_dir().unwrap_or_default().join("Documents/vault");
    if !vault.is_dir() { return "Vault not found at ~/Documents/vault".to_string(); }

    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    fn walk(dir: &std::path::Path, query: &str, results: &mut Vec<String>) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() && !path.file_name().map_or(false, |n| n.to_str().map_or(false, |s| s.starts_with('.'))) {
                    walk(&path, query, results);
                } else if path.extension().map_or(false, |e| e == "md") {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        if content.to_lowercase().contains(query) {
                            let name = path.strip_prefix(dirs::home_dir().unwrap_or_default().join("Documents/vault")).unwrap_or(&path);
                            // Get matching lines
                            let matches: Vec<&str> = content.lines()
                                .filter(|l| l.to_lowercase().contains(query))
                                .take(3)
                                .collect();
                            results.push(format!("**{}**\n{}", name.display(), matches.join("\n")));
                        }
                    }
                }
            }
        }
    }

    walk(&vault, &query_lower, &mut results);

    if results.is_empty() {
        format!("No notes found matching '{}'", query)
    } else {
        results.into_iter().take(5).collect::<Vec<_>>().join("\n\n---\n\n")
    }
}

#[tauri::command]
fn list_vault_notes() -> String {
    let vault = dirs::home_dir().unwrap_or_default().join("Documents/vault");
    if !vault.is_dir() { return "Vault not found".to_string(); }

    let mut notes = Vec::new();
    fn walk(dir: &std::path::Path, base: &std::path::Path, notes: &mut Vec<String>) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() && !path.file_name().map_or(false, |n| n.to_str().map_or(false, |s| s.starts_with('.'))) {
                    walk(&path, base, notes);
                } else if path.extension().map_or(false, |e| e == "md") {
                    let name = path.strip_prefix(base).unwrap_or(&path);
                    notes.push(name.display().to_string());
                }
            }
        }
    }
    walk(&vault, &vault, &mut notes);
    notes.sort();
    notes.join("\n")
}

#[tauri::command]
fn write_vault_note(path: String, content: String) -> String {
    let vault = dirs::home_dir().unwrap_or_default().join("Documents/vault");
    let full = vault.join(&path);
    if let Some(parent) = full.parent() { let _ = std::fs::create_dir_all(parent); }
    match std::fs::write(&full, &content) {
        Ok(_) => format!("Wrote note: {}", path),
        Err(e) => format!("Error: {}", e),
    }
}

#[tauri::command]
async fn ollama_chat(model: String, messages_json: String) -> Result<String, String> {
    // Run in async to avoid blocking Tauri's main thread
    let result = tokio::task::spawn_blocking(move || {
        let body = format!(r#"{{"model":"{}","messages":{},"stream":false}}"#, model, messages_json);
        let out = std::process::Command::new("curl")
            .args(["-s", "-m", "30", "http://localhost:11434/api/chat",
                   "-H", "Content-Type: application/json", "-d", &body])
            .output();
        match out {
            Ok(o) => {
                if let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&o.stdout) {
                    if let Some(content) = parsed["message"]["content"].as_str() {
                        return content.to_string();
                    }
                }
                String::from_utf8_lossy(&o.stdout).to_string()
            }
            Err(e) => format!("Error: {}", e),
        }
    }).await.map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
async fn analyze_image(prompt: String, image_base64: String, gemini_key: String) -> Result<String, String> {
    let result = tokio::task::spawn_blocking(move || {
        if !gemini_key.is_empty() {
            // Write request body to temp file (base64 is too large for command line)
            let body = serde_json::json!({
                "contents": [{"parts": [
                    {"text": prompt},
                    {"inline_data": {"mime_type": "image/png", "data": image_base64}}
                ]}]
            });
            let tmp_body = "/tmp/lens_gemini_body.json";
            let _ = std::fs::write(tmp_body, body.to_string());

            for model in &["gemini-2.5-flash", "gemini-2.0-flash-lite", "gemini-2.0-flash"] {
                let url = format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                    model, gemini_key
                );
                let out = std::process::Command::new("curl")
                    .args(["-s", "-m", "30", &url,
                           "-H", "Content-Type: application/json",
                           "-d", &format!("@{}", tmp_body)])
                    .output();
                if let Ok(o) = out {
                    if let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&o.stdout) {
                        if let Some(text) = parsed["candidates"][0]["content"]["parts"][0]["text"].as_str() {
                            if !text.is_empty() {
                                let _ = std::fs::remove_file(tmp_body);
                                return text.to_string();
                            }
                        }
                    }
                }
            }
            let _ = std::fs::remove_file(tmp_body);
        }

        // Fallback: OCR + text model
        let tmp_img = "/tmp/lens_analyze.png";
        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(&image_base64) {
            let _ = std::fs::write(tmp_img, &bytes);
        } else {
            return "Error: invalid image data".to_string();
        }
        let _ = std::process::Command::new("tesseract").args([tmp_img, "/tmp/lens_ocr", "-l", "eng"]).output();
        let text = std::fs::read_to_string("/tmp/lens_ocr.txt").unwrap_or_default();
        let _ = std::fs::remove_file(tmp_img);
        let _ = std::fs::remove_file("/tmp/lens_ocr.txt");

        if text.trim().is_empty() {
            return "Add a Gemini API key in Settings for full image analysis (free at aistudio.google.com/apikey)".to_string();
        }
        format!("Text from image: {}", &text[..text.len().min(500)])
    }).await.map_err(|e| e.to_string())?;
    Ok(result)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            run_command, read_file, write_file,
            read_file_base64, save_upload, take_screenshot,
            search_vault, list_vault_notes, write_vault_note,
            analyze_image, ollama_chat
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
