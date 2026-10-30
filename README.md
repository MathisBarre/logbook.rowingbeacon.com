![logo](https://github.com/MathisBarre/logbook.rowingbeacon.com/blob/main/public/banner.png?raw=true)

[rowingbeacon.com](https://rowingbeacon.com)

RowingBeacon is a digital logbook designed for rowing clubs. Available on the web and as a desktop app, it greatly simplifies outing management for clubs.

The app is inspired by traditional logbooks and digital ones like efa2, but offers a simpler but yet powerful experience.

## Statistics (Statistiques)

The Statistiques screen is an analytics hub with four tabs:

- **Tableau de bord**: pinned charts, laid out by the club's officials.
- **Rapports**: 29 prebuilt reports (activity, fleet, members, distances, safety), each with its chart, table, notes and exports (CSV, Excel, PNG, print).
- **Rapport annuel**: a one-click activity report for general meetings and grant files, as a printable page or an Excel workbook.
- **Explorer** (officials only): a SQL editor over simplified views, saved queries, a data dictionary and the proposals sent by AI assistants through MCP.

Queries run in Rust on a read-only connection with an authorizer (see `docs/adr/0008-statistiques-lecture-seule-et-ia.md`). Settings live in **Gestion › Statistiques et IA**:

- **AI assistant**: the club chooses its AI provider: Anthropic, OpenAI, or an OpenAI-compatible server (Mistral, OpenRouter, or a local model with Ollama or LM Studio). Each provider's key is stored in the OS keychain of each computer (or a `0600` file when there is none), never in the database or the backups; a compatible server's address is saved with its key (https, or http on this computer only). The provider receives the question, the structure of the tables and, if allowed, the boat and route names; never the rowers' data or the query results. Without a key, the request can be copied to any AI assistant (claude.ai, ChatGPT, Le Chat…) and the answer pasted back.
- **AI assistants on this computer (MCP)**: off by default. Once enabled, the tab shows the configuration to paste for Claude Desktop, Claude Code, Codex (ChatGPT desktop app, Codex CLI), Cursor and VS Code, plus the command line for any other local MCP client; the server is the app binary started with `--mcp` (no window). It reads the database read-only, pseudonymised by default, and proposals arrive in Explorer › Propositions, named after the assistant that sent them.
- **Performances**: the limits of a query (time, rows, result size, memory) follow a profile. *Économe* keeps the limits sized for a Raspberry Pi (10 s in the Explorer, 20 s for a report, 256 MB per query); *Standard* and *Puissant* give a laptop or a desktop up to 1 and 2 minutes, 50,000 rows and 768 MB. *Auto*, the default, picks the profile from the computer's memory and cores; a Raspberry Pi stays on Économe. Rust reads the setting and clamps every query to it.

## Tech Stack

This project is built using the following technologies:

- React
- TypeScript
- TailwindCSS
- Radix UI
- Tauri 2

## About the license

The Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0) license lets people share, modify, and build upon the work for free, but only for non-commercial purposes. Users must credit the original creator and agree to share any new versions or adaptations of the work under the same license. This ensures that the work and any adaptations remain non-commercial and open for others to use under the same conditions.

## Thanks

- [tdwesten for the drizzle integration in Tauri](https://github.com/tdwesten/tauri-drizzle-sqlite-proxy-demo)
