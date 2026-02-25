fn main() {
    let proto_dir = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .parent()
        .unwrap()
        .join("proto");
    let proto_file = proto_dir.join("gyrii.proto");
    println!("cargo:rerun-if-changed={}", proto_file.display());
    std::env::set_var(
        "PROTOC",
        protoc_bin_vendored::protoc_bin_path().unwrap().display().to_string(),
    );
    prost_build::Config::new()
        .compile_protos(&[proto_file], &[proto_dir])
        .expect("Failed to compile protos");
}
