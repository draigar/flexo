fn is_native_messaging_invocation() -> bool {
    let args: Vec<String> = std::env::args().collect();
    args.iter().any(|a| {
        a == "--native-messaging"
            || a.starts_with("chrome-extension://")
            || a.ends_with(".json")
            || a.contains("flexo-capture@")
    })
}

fn main() {
    if is_native_messaging_invocation() {
        flexo_lib::run_native_messaging();
        return;
    }
    flexo_lib::run();
}
