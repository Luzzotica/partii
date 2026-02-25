fn main() {
    let proto_dir = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .parent()
        .unwrap()
        .join("proto");
    let proto_files = [
        "common.proto",
        "player.proto",
        "ctf.proto",
        "combat.proto",
        "lobby.proto",
        "actions.proto",
        "delta.proto",
        "gyrii.proto",
    ];
    for name in &proto_files {
        println!("cargo:rerun-if-changed={}", proto_dir.join(name).display());
    }
    let proto_paths: Vec<_> = proto_files
        .iter()
        .map(|n| proto_dir.join(n))
        .collect();
    std::env::set_var(
        "PROTOC",
        protoc_bin_vendored::protoc_bin_path().unwrap().display().to_string(),
    );
    prost_build::Config::new()
        .compile_protos(&proto_paths, &[proto_dir.clone()])
        .expect("Failed to compile protos");
}
