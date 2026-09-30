use std::path::{Path, PathBuf};
use tauri::Manager;

pub const CHROME_EXTENSION_ID: &str = "nommklnplglkljkdleijiipfibabhjbm";
pub const FIREFOX_EXTENSION_ID: &str = "flexo-capture@flexo.app";

pub fn register_browser_integrations(app: &tauri::AppHandle) {
    register_native_messaging_host(app);
    register_external_extensions(app);
}

pub fn resolve_extension_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("extensions/browser");
        if p.join("manifest.json").is_file() {
            return std::fs::canonicalize(&p).ok().or(Some(p));
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../extensions/browser");
    if dev.join("manifest.json").is_file() {
        return std::fs::canonicalize(&dev).ok().or(Some(dev));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join("../Resources/extensions/browser");
            if candidate.join("manifest.json").is_file() {
                return std::fs::canonicalize(&candidate).ok().or(Some(candidate));
            }
        }
    }
    None
}

pub fn register_native_messaging_host(_app: &tauri::AppHandle) {
    let exe = match std::env::current_exe() {
        Ok(p) => std::fs::canonicalize(&p).unwrap_or(p),
        Err(_) => return,
    };

    let chrome_manifest = serde_json::json!({
        "name": "com.flexo.app",
        "description": "Flexo Download Manager",
        "path": exe.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [
            format!("chrome-extension://{CHROME_EXTENSION_ID}/")
        ]
    });

    let firefox_manifest = serde_json::json!({
        "name": "com.flexo.app",
        "description": "Flexo Download Manager",
        "path": exe.to_string_lossy(),
        "type": "stdio",
        "allowed_extensions": [
            FIREFOX_EXTENSION_ID
        ]
    });

    let chrome_manifest_str = serde_json::to_string_pretty(&chrome_manifest).unwrap_or_default();
    let firefox_manifest_str = serde_json::to_string_pretty(&firefox_manifest).unwrap_or_default();

    #[cfg(target_os = "macos")]
    write_macos_nm_manifests(&chrome_manifest_str, &firefox_manifest_str);

    #[cfg(target_os = "linux")]
    write_linux_nm_manifests(&chrome_manifest_str, &firefox_manifest_str);

    #[cfg(target_os = "windows")]
    write_windows_nm_manifests(&chrome_manifest_str, &firefox_manifest_str, &exe);
}

pub fn register_external_extensions(app: &tauri::AppHandle) {
    let ext_dir = match resolve_extension_dir(app) {
        Some(d) => d,
        None => return,
    };

    let chrome_external = serde_json::json!({
        "external_path": ext_dir.to_string_lossy()
    });
    let chrome_ext_str = serde_json::to_string_pretty(&chrome_external).unwrap_or_default();

    #[cfg(target_os = "macos")]
    write_macos_external_extensions(&chrome_ext_str, &ext_dir);

    #[cfg(target_os = "linux")]
    write_linux_external_extensions(&chrome_ext_str, &ext_dir);

    #[cfg(target_os = "windows")]
    write_windows_external_extensions(&ext_dir);
}

#[cfg(target_os = "macos")]
fn write_macos_nm_manifests(chrome_manifest: &str, firefox_manifest: &str) {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return,
    };

    let chromium_dirs = [
        home.join("Library/Application Support/Google/Chrome/NativeMessagingHosts"),
        home.join("Library/Application Support/Chromium/NativeMessagingHosts"),
        home.join("Library/Application Support/Microsoft Edge/NativeMessagingHosts"),
        home.join("Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"),
    ];

    for dir in &chromium_dirs {
        write_manifest_if_parent_exists(dir, "com.flexo.app.json", chrome_manifest);
    }

    let ff_dir = home.join("Library/Application Support/Mozilla/NativeMessagingHosts");
    write_manifest_if_parent_exists(&ff_dir, "com.flexo.app.json", firefox_manifest);
}

#[cfg(target_os = "macos")]
fn write_macos_external_extensions(chrome_ext_str: &str, ext_dir: &Path) {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return,
    };

    let filename = format!("{CHROME_EXTENSION_ID}.json");
    let chromium_dirs = [
        home.join("Library/Application Support/Google/Chrome/External Extensions"),
        home.join("Library/Application Support/Chromium/External Extensions"),
        home.join("Library/Application Support/Microsoft Edge/External Extensions"),
        home.join("Library/Application Support/BraveSoftware/Brave-Browser/External Extensions"),
    ];

    for dir in &chromium_dirs {
        write_manifest_if_parent_exists(dir, &filename, chrome_ext_str);
    }

    // Firefox standard extensions folder across all profiles
    let ff_dir = home.join("Library/Application Support/Mozilla/Extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}");
    if let Some(parent) = ff_dir.parent() {
        if parent.exists() {
            let _ = std::fs::create_dir_all(&ff_dir);
            let target_file = ff_dir.join(FIREFOX_EXTENSION_ID);
            let path_str = ext_dir.to_string_lossy().to_string();
            let _ = std::fs::write(target_file, path_str);
        }
    }
}

#[cfg(target_os = "linux")]
fn write_linux_nm_manifests(chrome_manifest: &str, firefox_manifest: &str) {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return,
    };

    let chromium_dirs = [
        home.join(".config/google-chrome/NativeMessagingHosts"),
        home.join(".config/chromium/NativeMessagingHosts"),
        home.join(".config/microsoft-edge/NativeMessagingHosts"),
        home.join(".config/BraveSoftware/Brave-Browser/NativeMessagingHosts"),
    ];

    for dir in &chromium_dirs {
        write_manifest_if_parent_exists(dir, "com.flexo.app.json", chrome_manifest);
    }

    let ff_dir = home.join(".mozilla/native-messaging-hosts");
    write_manifest_if_parent_exists(&ff_dir, "com.flexo.app.json", firefox_manifest);
}

#[cfg(target_os = "linux")]
fn write_linux_external_extensions(chrome_ext_str: &str, ext_dir: &Path) {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return,
    };

    let filename = format!("{CHROME_EXTENSION_ID}.json");
    let chromium_dirs = [
        home.join(".config/google-chrome/External Extensions"),
        home.join(".config/chromium/External Extensions"),
        home.join(".config/microsoft-edge/External Extensions"),
        home.join(".config/BraveSoftware/Brave-Browser/External Extensions"),
    ];

    for dir in &chromium_dirs {
        write_manifest_if_parent_exists(dir, &filename, chrome_ext_str);
    }

    let ff_dir = home.join(".mozilla/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}");
    if let Some(parent) = ff_dir.parent() {
        if parent.exists() {
            let _ = std::fs::create_dir_all(&ff_dir);
            let target_file = ff_dir.join(FIREFOX_EXTENSION_ID);
            let path_str = ext_dir.to_string_lossy().to_string();
            let _ = std::fs::write(target_file, path_str);
        }
    }
}

#[cfg(target_os = "windows")]
fn write_windows_nm_manifests(chrome_manifest: &str, firefox_manifest: &str, _exe: &Path) {
    let local_data = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("C:\\ProgramData"));
    let flexo_dir = local_data.join("Flexo");
    let _ = std::fs::create_dir_all(&flexo_dir);
    let chrome_manifest_path = flexo_dir.join("com.flexo.app.json");
    let _ = std::fs::write(&chrome_manifest_path, chrome_manifest);

    // Write Windows registry keys for Chrome & Edge Native Messaging
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let registry_paths = [
            r"Software\Google\Chrome\NativeMessagingHosts\com.flexo.app",
            r"Software\Microsoft\Edge\NativeMessagingHosts\com.flexo.app",
        ];

        for subkey_path in &registry_paths {
            if let Ok((key, _)) = hkcu.create_subkey(subkey_path) {
                let path_str = chrome_manifest_path.to_string_lossy();
                let _ = key.set_value("", &path_str.as_ref());
            }
        }

        // Firefox uses AppData\Roaming\Mozilla\NativeMessagingHosts\com.flexo.app.json
        if let Some(roaming) = dirs::data_dir() {
            let ff_dir = roaming.join("Mozilla").join("NativeMessagingHosts");
            let _ = std::fs::create_dir_all(&ff_dir);
            let _ = std::fs::write(ff_dir.join("com.flexo.app.json"), firefox_manifest);
        }
    }
}

#[cfg(target_os = "windows")]
fn write_windows_external_extensions(ext_dir: &Path) {
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let path_str = ext_dir.to_string_lossy();

        let registry_paths = [
            format!(r"Software\Google\Chrome\Extensions\{CHROME_EXTENSION_ID}"),
            format!(r"Software\Microsoft\Edge\Extensions\{CHROME_EXTENSION_ID}"),
        ];

        for subkey_path in &registry_paths {
            if let Ok((key, _)) = hkcu.create_subkey(subkey_path) {
                let _ = key.set_value("path", &path_str.as_ref());
            }
        }

        if let Ok((key, _)) = hkcu.create_subkey(r"Software\Mozilla\Firefox\Extensions") {
            let _ = key.set_value(FIREFOX_EXTENSION_ID, &path_str.as_ref());
        }
    }
}

fn write_manifest_if_parent_exists(dir: &Path, filename: &str, content: &str) {
    // If the browser directory's parent exists (meaning the browser or Application Support is present),
    // ensure the target directory exists and write the file.
    if let Some(parent) = dir.parent() {
        if parent.exists() {
            let _ = std::fs::create_dir_all(dir);
            let target_file = dir.join(filename);
            // Only write if content differs to avoid unnecessary mtime churn
            if let Ok(existing) = std::fs::read_to_string(&target_file) {
                if existing == content {
                    return;
                }
            }
            let _ = std::fs::write(target_file, content);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_manifest_structure() {
        let exe = std::path::PathBuf::from("/Applications/Flexo.app/Contents/MacOS/Flexo");
        let chrome_manifest = serde_json::json!({
            "name": "com.flexo.app",
            "description": "Flexo Download Manager",
            "path": exe.to_string_lossy(),
            "type": "stdio",
            "allowed_origins": [
                format!("chrome-extension://{CHROME_EXTENSION_ID}/")
            ]
        });
        assert_eq!(chrome_manifest["name"], "com.flexo.app");
        assert_eq!(
            chrome_manifest["allowed_origins"][0],
            "chrome-extension://nommklnplglkljkdleijiipfibabhjbm/"
        );
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_register_on_macos() {
        let exe = std::env::current_exe()
            .unwrap_or_else(|_| std::path::PathBuf::from("/Applications/Flexo.app/Contents/MacOS/Flexo"));
        let chrome_manifest = serde_json::json!({
            "name": "com.flexo.app",
            "description": "Flexo Download Manager",
            "path": exe.to_string_lossy(),
            "type": "stdio",
            "allowed_origins": [
                format!("chrome-extension://{CHROME_EXTENSION_ID}/")
            ]
        });
        let firefox_manifest = serde_json::json!({
            "name": "com.flexo.app",
            "description": "Flexo Download Manager",
            "path": exe.to_string_lossy(),
            "type": "stdio",
            "allowed_extensions": [
                FIREFOX_EXTENSION_ID
            ]
        });
        write_macos_nm_manifests(
            &serde_json::to_string_pretty(&chrome_manifest).unwrap(),
            &serde_json::to_string_pretty(&firefox_manifest).unwrap(),
        );

        let raw_ext_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../extensions/browser");
        let ext_dir = std::fs::canonicalize(&raw_ext_dir).unwrap_or(raw_ext_dir);
        let chrome_external = serde_json::json!({
            "external_path": ext_dir.to_string_lossy()
        });
        write_macos_external_extensions(
            &serde_json::to_string_pretty(&chrome_external).unwrap(),
            &ext_dir,
        );
    }
}
