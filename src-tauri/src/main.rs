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

/// Raise the soft open-file limit to 8192 on macOS and Linux so that up to
/// 100 concurrent downloads (each with multiple TCP connections and part files)
/// are supported without hitting "too many open files" EMFILE errors.
#[cfg(unix)]
fn raise_fd_limit() {
    unsafe {
        let mut rlim = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        if libc::getrlimit(libc::RLIMIT_NOFILE, &mut rlim) == 0 {
            let target = 8192.min(rlim.rlim_max);
            if target > rlim.rlim_cur {
                rlim.rlim_cur = target;
                let _ = libc::setrlimit(libc::RLIMIT_NOFILE, &rlim);
            }
        }
    }
}

/// On Windows the CRT limits stdio streams to 512 by default.
/// _setmaxstdio raises this to the requested value (max 2048).
/// This is the Windows equivalent of raising RLIMIT_NOFILE.
#[cfg(windows)]
fn raise_fd_limit() {
    extern "C" {
        fn _setmaxstdio(new_max: i32) -> i32;
    }
    unsafe {
        _setmaxstdio(2048);
    }
}

fn main() {
    raise_fd_limit();

    if is_native_messaging_invocation() {
        flexo_lib::run_native_messaging();
        return;
    }
    flexo_lib::run();
}
