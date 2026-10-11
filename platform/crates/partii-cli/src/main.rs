fn main() {
    println!("{}", serde_json::json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") }));
}
