//! The torture scenarios: which network each side sits on, and what happens
//! mid-session.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Net {
    /// Straight on the WAN (Docker's own NAT to the internet).
    Open,
    /// A home router: endpoint-independent NAT, so hole punching works.
    Nat,
    /// Carrier-grade NAT: two symmetric NATs in a row. Direct is impossible.
    Cgnat,
    /// A home router that drops all UDP except DNS.
    UdpBlocked,
    /// Only TCP 443 (and DNS) gets out, like hotel, school and office Wi-Fi.
    Tcp443,
    /// A bad link: 60 ms ± 20 ms each way and 5% loss both ways.
    Lossy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Disruption {
    /// The guest moves to another network mid-game (Wi-Fi to cellular).
    SwitchNetwork,
    /// The guest is frozen for 10 s mid-game (the app was backgrounded).
    Background,
}

#[derive(Debug, Clone, Serialize)]
pub struct Scenario {
    pub name: &'static str,
    pub about: &'static str,
    pub host_net: Net,
    pub guest_net: Net,
    pub disruption: Option<Disruption>,
}

pub fn all() -> Vec<Scenario> {
    use Disruption::*;
    use Net::*;
    let s = |name, about, host_net, guest_net, disruption| Scenario { name, about, host_net, guest_net, disruption };
    vec![
        s("open", "both peers straight on the internet", Open, Open, None),
        s("home-nat", "both peers behind home routers", Nat, Nat, None),
        s("cgnat", "both peers behind carrier-grade NAT (symmetric, twice)", Cgnat, Cgnat, None),
        s("udp-blocked", "the guest's network drops UDP", Nat, UdpBlocked, None),
        s("tcp443-only", "the guest's network only lets TCP 443 out", Nat, Tcp443, None),
        s("lossy", "the guest is on a bad link: 60±20 ms each way, 5% loss", Nat, Lossy, None),
        s("network-switch", "the guest switches networks mid-game", Nat, Nat, Some(SwitchNetwork)),
        s("background", "the guest is frozen for 10 s mid-game", Nat, Nat, Some(Background)),
    ]
}
