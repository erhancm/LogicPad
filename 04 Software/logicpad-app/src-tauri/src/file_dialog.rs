//! Native save/load for LogicPad YAML packs.
//!
//! Parent wires this in `lib.rs` (do not forget `mod file_dialog;`):
//!
//! ```ignore
//! #[tauri::command]
//! fn save_text_file(name: String, contents: String) -> Option<String> {
//!     file_dialog::save_text_file(&name, &contents)
//! }
//!
//! #[tauri::command]
//! fn load_text_file() -> Option<(String, String)> {
//!     file_dialog::load_text_file()
//! }
//! ```
//!
//! Then add `save_text_file` and `load_text_file` to `tauri::generate_handler![...]`.
//!
//! Frontend:
//! `invoke<string | null>("save_text_file", { name, contents })`
//! `invoke<[string, string] | null>("load_text_file")`  // [path, contents]

use std::fs;

const YAML_FILTER: &[&str] = &["yaml", "yml"];

/// Open a Save dialog (YAML). Writes `contents` and returns the path, or `None` if
/// the user cancels or the write fails.
pub fn save_text_file(suggested_name: &str, contents: &str) -> Option<String> {
    let mut dlg = rfd::FileDialog::new()
        .add_filter("YAML", YAML_FILTER)
        .set_title("Save LogicPad YAML");
    let name = suggested_name.trim();
    if !name.is_empty() {
        dlg = dlg.set_file_name(name);
    }
    let path = dlg.save_file()?;
    fs::write(&path, contents).ok()?;
    Some(path.to_string_lossy().into_owned())
}

/// Open an Open dialog (YAML). Returns `(path, contents)`, or `None` if the user
/// cancels or the file cannot be read as UTF-8 text.
pub fn load_text_file() -> Option<(String, String)> {
    let path = rfd::FileDialog::new()
        .add_filter("YAML", YAML_FILTER)
        .set_title("Open LogicPad YAML")
        .pick_file()?;
    let contents = fs::read_to_string(&path).ok()?;
    Some((path.to_string_lossy().into_owned(), contents))
}
