use super::*;

fn core(no_webrtc: bool) -> Core {
    Core::new(Config { edge: "https://edge.example".into(), key: "pk".into(), conn: "c".repeat(20), client: "t".into(), player_token: None, no_webrtc })
}

fn online(c: &mut Core, relay: &str) {
    c.tick(0.0);
    c.on_socket_open(0.0);
    let ice = if relay == "turn" {
        json!([{"urls": ["stun:s:3478", "turn:t:3478", "turns:t:443"], "username": "u", "credential": "p"}])
    } else {
        json!([])
    };
    c.on_text(&json!({"t": "welcome", "resumed": false, "relay": relay, "ice_servers": ice}).to_string(), 0.0);
    c.drain();
}

fn room(you: u16, mids: &[u16]) -> Value {
    json!({
        "code": "ABCDE", "game": "g", "host": 1, "you": you, "joinable": true, "max_members": 8, "meta": null,
        "members": mids.iter().map(|m| json!({"mid": m, "kind": "game", "name": "", "meta": null, "status": "active"})).collect::<Vec<_>>()
    })
}

fn texts(actions: &[Action]) -> Vec<Value> {
    actions.iter().filter_map(|a| if let Action::SendText(t) = a { serde_json::from_str(t).ok() } else { None }).collect()
}
fn events(actions: &[Action]) -> Vec<Event> {
    actions.iter().filter_map(|a| if let Action::Emit(e) = a { Some(e.clone()) } else { None }).collect()
}

#[test]
fn derives_the_socket_url() {
    assert_eq!(core(true).url(), format!("wss://edge.example/v1/connect?conn={}", "c".repeat(20)));
    let mut c = core(true);
    c.cfg.edge = "http://127.0.0.1:8787/".into();
    assert!(c.url().starts_with("ws://127.0.0.1:8787/v1/connect?conn="));
}

#[test]
fn connects_then_says_hello_then_goes_online() {
    let mut c = core(true);
    c.tick(0.0);
    assert!(matches!(c.drain()[..], [Action::Connect { .. }]));
    c.on_socket_open(0.0);
    let hello = texts(&c.drain());
    assert_eq!(hello[0]["t"], "hello");
    assert_eq!(hello[0]["v"], 1);
    c.on_text(r#"{"t":"welcome","resumed":false,"relay":"ws","ice_servers":[]}"#, 1.0);
    assert_eq!(events(&c.drain()), vec![Event::Online { resumed: false, relay: "ws".into() }]);
    assert!(c.online());
}

#[test]
fn requests_fail_fast_while_offline() {
    let mut c = core(true);
    let id = c.create("g", None, "game", "", Value::Null);
    assert!(matches!(&events(&c.drain())[0], Event::Failed { req, code, .. } if *req == id && code == "offline"));
}

#[test]
fn create_then_member_joins_and_packets_flow_over_ws() {
    let mut c = core(true);
    online(&mut c, "ws");
    let id = c.create("g", Some(4), "game", "H", Value::Null);
    assert_eq!(texts(&c.drain())[0]["t"], "create");
    c.on_text(&json!({"t": "ok", "id": id, "room": room(1, &[1])}).to_string(), 5.0);
    assert!(matches!(&events(&c.drain())[0], Event::Created { req, room } if *req == id && room.you == 1));
    c.on_text(&json!({"t": "member_joined", "member": {"mid": 2, "kind": "game", "name": "G", "meta": null, "status": "active"}}).to_string(), 6.0);
    let ev = events(&c.drain());
    assert!(ev.contains(&Event::PeerConnected { mid: 2, path: PathId::Ws }));
    assert!(ev.iter().any(|e| matches!(e, Event::MemberJoined { member } if member.mid == 2)));
    c.send(2, true, b"hi", 7.0);
    let frames: Vec<Vec<u8>> = c.drain().into_iter().filter_map(|a| if let Action::SendBinary(b) = a { Some(b) } else { None }).collect();
    assert!(frames.iter().any(|f| f[0] == RELAY_FRAME && f[1..3] == [0, 2] && f.ends_with(b"hi")));
}

#[test]
fn incoming_relay_frames_become_messages() {
    let mut a = core(true);
    let mut b = core(true);
    for (c, you) in [(&mut a, 1u16), (&mut b, 2u16)] {
        online(c, "ws");
        let id = c.join("ABCDE", "game", "", Value::Null);
        c.drain();
        c.on_text(&json!({"t": "ok", "id": id, "room": room(you, &[1, 2])}).to_string(), 0.0);
        c.drain();
    }
    a.send(2, true, b"reliable", 1.0);
    a.send(2, false, b"fast", 1.0);
    for act in a.drain() {
        if let Action::SendBinary(f) = act {
            let mut rewritten = f.clone();
            rewritten[1..3].copy_from_slice(&1u16.to_be_bytes()); // the edge stamps the sender
            b.on_binary(&rewritten, 2.0);
        }
    }
    let got: Vec<(bool, Vec<u8>)> = events(&b.drain()).into_iter().filter_map(|e| if let Event::Message { reliable, bytes, from: 1 } = e { Some((reliable, bytes)) } else { None }).collect();
    assert!(got.contains(&(true, b"reliable".to_vec())));
    assert!(got.contains(&(false, b"fast".to_vec())));
}

#[test]
fn the_lower_member_offers_turn_and_direct() {
    let mut c = core(false);
    online(&mut c, "turn");
    let id = c.join("ABCDE", "game", "", Value::Null);
    c.drain();
    c.on_text(&json!({"t": "ok", "id": id, "room": room(1, &[1, 3])}).to_string(), 0.0);
    c.tick(1.0);
    let creates: Vec<(PathId, bool, bool, usize)> = c
        .drain()
        .into_iter()
        .filter_map(|a| if let Action::CreatePc { path, offerer, relay_only, ice, .. } = a { Some((path, offerer, relay_only, ice.len())) } else { None })
        .collect();
    assert!(creates.contains(&(PathId::Turn, true, true, 1)));
    // Direct gets STUN only.
    assert!(creates.contains(&(PathId::Direct, true, false, 1)));
}

#[test]
fn the_higher_member_waits_for_offers_and_answers_them() {
    let mut c = core(false);
    online(&mut c, "turn");
    let id = c.join("ABCDE", "game", "", Value::Null);
    c.drain();
    c.on_text(&json!({"t": "ok", "id": id, "room": room(2, &[1, 2])}).to_string(), 0.0);
    c.tick(1.0);
    assert!(!c.drain().iter().any(|a| matches!(a, Action::CreatePc { .. })));
    c.on_text(&json!({"t": "signal", "from": 1, "data": {"pc": "turn", "gen": 1, "type": "offer", "sdp": "x"}}).to_string(), 2.0);
    let acts = c.drain();
    assert!(acts.iter().any(|a| matches!(a, Action::CreatePc { mid: 1, path: PathId::Turn, gen: 1, offerer: false, .. })));
    assert!(acts.iter().any(|a| matches!(a, Action::PcSignal { mid: 1, path: PathId::Turn, gen: 1, .. })));
    // A stale generation is ignored; a newer offer rebuilds.
    c.on_text(&json!({"t": "signal", "from": 1, "data": {"pc": "turn", "gen": 0, "type": "offer"}}).to_string(), 3.0);
    assert!(c.drain().is_empty());
    c.on_text(&json!({"t": "signal", "from": 1, "data": {"pc": "turn", "gen": 2, "type": "offer"}}).to_string(), 4.0);
    assert!(c.drain().iter().any(|a| matches!(a, Action::CreatePc { gen: 2, offerer: false, .. })));
}

#[test]
fn a_failed_path_is_rebuilt_with_backoff_by_the_offerer() {
    let mut c = core(false);
    online(&mut c, "turn");
    let id = c.join("ABCDE", "game", "", Value::Null);
    c.drain();
    c.on_text(&json!({"t": "ok", "id": id, "room": room(1, &[1, 2])}).to_string(), 0.0);
    c.tick(1.0);
    c.drain();
    c.on_pc_open(2, PathId::Turn, 1, 100.0);
    c.on_pc_closed(2, PathId::Turn, 1, 200.0);
    c.tick(500.0);
    assert!(!c.drain().iter().any(|a| matches!(a, Action::CreatePc { path: PathId::Turn, .. })), "waits out the backoff");
    c.tick(1300.0);
    assert!(c.drain().iter().any(|a| matches!(a, Action::CreatePc { path: PathId::Turn, gen: 2, .. })));
}

#[test]
fn a_dropped_socket_reconnects_and_resumes_the_room() {
    let mut c = core(true);
    online(&mut c, "ws");
    let id = c.join("ABCDE", "game", "", Value::Null);
    c.drain();
    c.on_text(&json!({"t": "ok", "id": id, "room": room(2, &[1, 2])}).to_string(), 0.0);
    c.drain();
    let pending = c.update(json!({"joinable": false}));
    c.on_socket_closed(100.0);
    let ev = events(&c.drain());
    assert!(ev.contains(&Event::Offline));
    assert!(ev.iter().any(|e| matches!(e, Event::Failed { req, .. } if *req == pending)));
    assert!(!c.link(1).unwrap().path(PathId::Ws).open);
    c.tick(100.0);
    assert!(matches!(c.drain()[..], [Action::Connect { .. }]), "first retry is immediate");
    c.on_socket_closed(120.0);
    c.tick(200.0);
    assert!(c.drain().is_empty(), "second retry waits");
    c.tick(400.0);
    assert!(matches!(c.drain()[..], [Action::Connect { .. }]));
    c.on_socket_open(0.0);
    c.drain();
    c.on_text(&json!({"t": "welcome", "resumed": true, "relay": "ws", "ice_servers": [], "room": room(2, &[1, 2])}).to_string(), 450.0);
    assert!(events(&c.drain()).contains(&Event::Online { resumed: true, relay: "ws".into() }));
    assert_eq!(c.room().unwrap().you, 2);
    assert!(c.link(1).unwrap().path(PathId::Ws).open);
}

#[test]
fn a_fresh_session_after_a_long_drop_closes_the_room() {
    let mut c = core(true);
    online(&mut c, "ws");
    let id = c.join("ABCDE", "game", "", Value::Null);
    c.drain();
    c.on_text(&json!({"t": "ok", "id": id, "room": room(2, &[1, 2])}).to_string(), 0.0);
    c.on_socket_closed(1.0);
    c.tick(2.0);
    c.on_socket_open(0.0);
    c.drain();
    c.on_text(r#"{"t":"welcome","resumed":false,"relay":"ws","ice_servers":[]}"#, 3.0);
    assert!(events(&c.drain()).contains(&Event::RoomClosed { reason: "expired".into() }));
    assert!(c.room().is_none());
}

#[test]
fn suspended_members_lose_the_ws_path_until_they_resume() {
    let mut c = core(true);
    online(&mut c, "ws");
    let id = c.join("ABCDE", "game", "", Value::Null);
    c.drain();
    c.on_text(&json!({"t": "ok", "id": id, "room": room(1, &[1, 2])}).to_string(), 0.0);
    c.on_text(r#"{"t":"member_suspended","mid":2}"#, 1.0);
    assert!(!c.link(2).unwrap().path(PathId::Ws).open);
    c.on_text(r#"{"t":"member_resumed","mid":2}"#, 2.0);
    assert!(c.link(2).unwrap().path(PathId::Ws).open);
    assert_eq!(c.room().unwrap().members[1].status, "active");
}

#[test]
fn a_silent_socket_is_pinged_then_replaced() {
    let mut c = core(true);
    online(&mut c, "ws");
    c.tick(1200.0);
    assert!(c.drain().contains(&Action::SendText("ping".into())));
    c.on_text("pong", 1300.0);
    c.tick(3000.0);
    assert!(c.online(), "a pong keeps it alive");
    c.tick(5000.0);
    let acts = c.drain();
    assert!(acts.iter().any(|a| matches!(a, Action::Emit(Event::Offline))));
    assert!(acts.iter().any(|a| matches!(a, Action::Connect { .. })), "reconnects at once");
}

#[test]
fn a_resume_restarts_unopened_paths_at_once() {
    // Offerer side: a failed path waiting out its backoff restarts on resume.
    let mut c = core(false);
    online(&mut c, "turn");
    let id = c.join("ABCDE", "game", "", Value::Null);
    c.drain();
    c.on_text(&json!({"t": "ok", "id": id, "room": room(1, &[1, 2])}).to_string(), 0.0);
    c.tick(1.0);
    c.drain();
    c.on_pc_closed(2, PathId::Turn, 1, 100.0);
    c.on_pc_closed(2, PathId::Turn, 1, 100.0);
    c.on_text(r#"{"t":"member_suspended","mid":2}"#, 200.0);
    c.on_text(r#"{"t":"member_resumed","mid":2}"#, 300.0);
    c.tick(310.0);
    assert!(c.drain().iter().any(|a| matches!(a, Action::CreatePc { path: PathId::Turn, .. })), "no backoff wait after a resume");

    // Answerer side: asks the offerer to restart.
    let mut g = core(false);
    online(&mut g, "turn");
    let id = g.join("ABCDE", "game", "", Value::Null);
    g.drain();
    g.on_text(&json!({"t": "ok", "id": id, "room": room(2, &[1, 2])}).to_string(), 0.0);
    g.drain();
    g.on_text(r#"{"t":"member_resumed","mid":1}"#, 50.0);
    let asks: Vec<Value> = texts(&g.drain()).into_iter().filter(|t| t["t"] == "signal" && t["data"]["type"] == "restart").collect();
    assert_eq!(asks.len(), 2, "turn and direct");
}

#[test]
fn the_room_comes_before_its_peers() {
    let mut c = core(true);
    online(&mut c, "ws");
    let id = c.join("ABCDE", "game", "", Value::Null);
    c.drain();
    c.on_text(&json!({"t": "ok", "id": id, "room": room(2, &[1, 2])}).to_string(), 0.0);
    let ev = events(&c.drain());
    let joined = ev.iter().position(|e| matches!(e, Event::Joined { .. })).unwrap();
    let peer = ev.iter().position(|e| matches!(e, Event::PeerConnected { mid: 1, .. })).unwrap();
    assert!(joined < peer, "{ev:?}");
    c.on_text(&json!({"t": "member_joined", "member": {"mid": 3, "kind": "game", "name": "", "meta": null, "status": "active"}}).to_string(), 1.0);
    let ev = events(&c.drain());
    let joined = ev.iter().position(|e| matches!(e, Event::MemberJoined { .. })).unwrap();
    let peer = ev.iter().position(|e| matches!(e, Event::PeerConnected { mid: 3, .. })).unwrap();
    assert!(joined < peer, "{ev:?}");
}
