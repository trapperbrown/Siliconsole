use std::path::PathBuf;
use std::sync::LazyLock;

use crate::generated::AppConfig;

/// The central config, compiled in from shared/config/defaults.json.
pub static CONFIG: LazyLock<AppConfig> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../shared/config/defaults.json")).expect("defaults.json is valid")
});

/// %APPDATA%\{appDataFolder}
pub fn app_data_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    base.join(&CONFIG.app_data_folder)
}
