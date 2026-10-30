// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[cfg_attr(mobile, tauri::mobile_entry_point)]
use tauri_plugin_sql::{ Migration, MigrationKind };

mod analytics_commands;

pub fn run() {
    let migrations = vec![
        // Define your migrations here
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: "
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
        ",
            kind: MigrationKind::Up,
        }
    ];

    tauri::Builder
        ::default()
        .setup(|app| {
            #[cfg(desktop)]
            if
                let Err(e) = app
                    .handle()
                    .plugin(
                        tauri_plugin_autostart::init(
                            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                            Some(
                                vec!["--flag1", "--flag2"]
                            ) /* arbitrary number of args to pass to your app */
                        )
                    )
            {
                eprintln!("Failed to initialize autostart plugin: {}", e);
            }
            // Updates come from the public mirror's GitHub releases (latest.json).
            #[cfg(desktop)]
            if let Err(e) = app.handle().plugin(tauri_plugin_updater::Builder::new().build()) {
                eprintln!("Failed to initialize updater plugin: {}", e);
            }
            Ok(())
        })
        .plugin(tauri_plugin_fs::init())
        // Keeps folders picked by the club (backup copy) reachable after a restart.
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::new().add_migrations("sqlite:main.db", migrations).build()
        )
        .plugin(tauri_plugin_shell::init())
        // Restarts the app once an update is installed.
        .plugin(tauri_plugin_process::init())
        // Analytics (ADR 0008): read-only engine state and its commands.
        .manage(std::sync::Arc::new(rb_analytics::engine::EngineState::new()))
        .invoke_handler(
            tauri::generate_handler![
                analytics_commands::analytics_run_query,
                analytics_commands::analytics_cancel_query,
                analytics_commands::analytics_list_objects,
                analytics_commands::analytics_ai_key_status,
                analytics_commands::analytics_ai_set_key,
                analytics_commands::analytics_ai_delete_key,
                analytics_commands::analytics_ai_test_key,
                analytics_commands::analytics_ai_ask,
                analytics_commands::analytics_mcp_info,
                analytics_commands::analytics_mcp_last_call,
                analytics_commands::analytics_machine_info,
                analytics_commands::analytics_inbox_list,
                analytics_commands::analytics_inbox_remove
            ]
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
