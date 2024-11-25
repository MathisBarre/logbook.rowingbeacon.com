// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[cfg_attr(mobile, tauri::mobile_entry_point)]
use tauri_plugin_sql::{ Migration, MigrationKind };

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
            Ok(())
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::new().add_migrations("sqlite:main.db", migrations).build()
        )
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
