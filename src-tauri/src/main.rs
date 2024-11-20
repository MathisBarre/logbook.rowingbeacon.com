// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri_plugin_sql::{ Migration, MigrationKind };

fn main() {
    let migrations = vec![
        // Define your migrations here
        Migration {
            version: 1,
            description: "create_session_tables",
            sql: "
CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    boat_id TEXT NOT NULL, 
    start_date_time TEXT NOT NULL, 
    estimated_end_date_time TEXT,
    route_id TEXT,
    end_date_time TEXT,
    incident_id TEXT,
    comment TEXT
);

CREATE TABLE IF NOT EXISTS session_rowers (
    session_id TEXT NOT NULL,
    rower_id TEXT NOT NULL,
    PRIMARY KEY (session_id, rower_id),
    FOREIGN KEY (session_id) REFERENCES session (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_rowers_rower_id ON session_rowers (rower_id);
CREATE INDEX IF NOT EXISTS idx_session_rowers_session_id ON session_rowers (session_id);
            ",
            kind: MigrationKind::Up,
        }
    ];

    tauri::Builder
        ::default()
        .plugin(
            tauri_plugin_sql::Builder::new().add_migrations("sqlite:main.db", migrations).build()
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
