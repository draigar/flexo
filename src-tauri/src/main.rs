// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn is_native_messaging_invocation() -> bool {
    let args: Vec<String> = std::env::args().collect();
    args.iter().any(|a| {
        a == "--native-messaging"
            || a.starts_with("chrome-extension://")
            || a.starts_with("edge-extension://")
            || a.ends_with(".json")
            || a.contains("flexo-capture@")
            || a.contains("nommklnplglkljkdleijiipfibabhjbm")
    })
}

fn main() {
    if is_native_messaging_invocation() {
        flexo_lib::run_native_messaging();
        return;
    }
    flexo_lib::run();
}
