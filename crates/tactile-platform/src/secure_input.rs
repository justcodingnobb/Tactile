#[cfg(target_os = "macos")]
mod macos {
    #[link(name = "Carbon", kind = "framework")]
    unsafe extern "C" {
        fn IsSecureEventInputEnabled() -> bool;
    }

    pub fn is_secure_input_enabled() -> bool {
        unsafe { IsSecureEventInputEnabled() }
    }
}

#[cfg(not(target_os = "macos"))]
mod macos {
    pub fn is_secure_input_enabled() -> bool {
        false
    }
}

pub use macos::is_secure_input_enabled;
