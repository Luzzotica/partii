//! Docker topologies for torture scenarios: real Linux NAT, packet filters
//! and netem, one isolated set of networks and containers per scenario.
//!
//! Every scenario gets a WAN bridge (the "internet", with real outbound
//! access through Docker) and LANs behind router containers. Clients route
//! through their router, so what the router does (NAT type, filtering, loss)
//! is what the client's network does.

use super::scenario::{Disruption, Net, Scenario};
use crate::out::CliError;
use std::process::Command;

pub const CLIENT_IMAGE: &str = "partii-torture-client";
pub const ROUTER_IMAGE: &str = "partii-torture-router";

pub fn docker(args: &[&str]) -> Result<String, CliError> {
    let o = Command::new("docker").args(args).output().map_err(|e| {
        CliError::new("docker_missing", format!("cannot run docker: {e}"), "install Docker Desktop and start it")
    })?;
    if !o.status.success() {
        return Err(CliError::new(
            "docker_failed",
            format!("docker {}: {}", args.join(" "), String::from_utf8_lossy(&o.stderr).trim()),
            "is Docker running? `docker ps` should work; stale torture containers can be removed with `partii torture clean`",
        ));
    }
    Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// One scenario's live topology. Names are `<prefix>-...`; subnets are
/// `10.<octet>.<n>.0/24` so scenarios can run side by side.
#[derive(Clone)]
pub struct Topo {
    pub prefix: String,
    octet: u8,
    pub host: String,
    pub guest: String,
    /// Bind mounts for the client containers (`host_path:container_path`).
    mounts: Vec<String>,
}

impl Topo {
    pub fn new(prefix: &str, octet: u8, mounts: Vec<String>) -> Self {
        Self { prefix: prefix.into(), octet, host: format!("{prefix}-host"), guest: format!("{prefix}-guest"), mounts }
    }

    fn subnet(&self, n: u8) -> String {
        format!("10.{}.{n}.0/24", self.octet)
    }
    fn ip(&self, n: u8, h: u8) -> String {
        format!("10.{}.{n}.{h}", self.octet)
    }

    pub fn up(&self, s: &Scenario) -> Result<(), CliError> {
        self.down();
        let wan = format!("{}-wan", self.prefix);
        docker(&["network", "create", &wan])?;
        self.side(&self.host.clone(), s.host_net, 1, &wan)?;
        self.side(&self.guest.clone(), s.guest_net, 2, &wan)?;
        if matches!(s.disruption, Some(Disruption::SwitchNetwork)) {
            // A second LAN and router the guest moves onto mid-session.
            self.lan_router(9, &wan, Net::Nat)?;
        }
        Ok(())
    }

    /// One client on `net`. LAN numbers: n (and 10+n for a CGNAT's middle hop).
    fn side(&self, name: &str, net: Net, n: u8, wan: &str) -> Result<(), CliError> {
        if net == Net::Open {
            return self.client(name, wan, None);
        }
        let router_lan_ip = self.lan_router(n, wan, net)?;
        let lan = format!("{}-lan{n}", self.prefix);
        self.client(name, &lan, Some((&self.ip(n, 10), &router_lan_ip)))
    }

    /// A LAN with a router onto the WAN (or onto a carrier hop for CGNAT).
    /// Returns the router's LAN address.
    fn lan_router(&self, n: u8, wan: &str, net: Net) -> Result<String, CliError> {
        let lan = format!("{}-lan{n}", self.prefix);
        docker(&["network", "create", "--subnet", &self.subnet(n), &lan])?;
        let router = format!("{}-router{n}", self.prefix);
        let router_ip = self.ip(n, 2);
        let upstream = if net == Net::Cgnat {
            // The carrier: the home router NATs onto a carrier network, and
            // the carrier NATs again onto the WAN, both symmetric.
            let carrier = format!("{}-carrier{n}", self.prefix);
            let carrier_net = format!("{}-cg{n}", self.prefix);
            docker(&["network", "create", "--subnet", &self.subnet(100 + n), &carrier_net])?;
            self.router(&carrier, wan)?;
            docker(&["network", "connect", "--ip", &self.ip(100 + n, 2), &carrier_net, &carrier])?;
            nat(&carrier, &self.iface(&carrier, wan)?, true)?;
            Some((carrier_net, self.ip(100 + n, 2)))
        } else {
            None
        };
        match &upstream {
            Some((carrier_net, carrier_ip)) => {
                self.router(&router, carrier_net)?;
                docker(&["exec", &router, "ip", "route", "replace", "default", "via", carrier_ip])?;
            }
            None => self.router(&router, wan)?,
        }
        docker(&["network", "connect", "--ip", &router_ip, &lan, &router])?;
        let up_if = match &upstream {
            Some((carrier_net, _)) => self.iface(&router, carrier_net)?,
            None => self.iface(&router, wan)?,
        };
        nat(&router, &up_if, net == Net::Cgnat)?;
        match net {
            Net::UdpBlocked => {
                for r in [
                    "iptables -A FORWARD -p udp --dport 53 -j ACCEPT",
                    "iptables -A FORWARD -p udp --sport 53 -j ACCEPT",
                    "iptables -A FORWARD -p udp -j DROP",
                ] {
                    sh(&router, r)?;
                }
            }
            Net::Tcp443 => {
                for r in [
                    "iptables -A FORWARD -m state --state ESTABLISHED,RELATED -j ACCEPT",
                    "iptables -A FORWARD -p udp --dport 53 -j ACCEPT",
                    "iptables -A FORWARD -p tcp --dport 53 -j ACCEPT",
                    "iptables -A FORWARD -p tcp --dport 443 -j ACCEPT",
                    "iptables -A FORWARD -j DROP",
                ] {
                    sh(&router, r)?;
                }
            }
            Net::Lossy => {
                // Both directions: WAN egress (uploads) and LAN egress (downloads).
                let lan_if = self.iface(&router, &lan)?;
                sh(&router, &format!("tc qdisc add dev {up_if} root netem delay 60ms 20ms distribution normal loss 5%"))?;
                sh(&router, &format!("tc qdisc add dev {lan_if} root netem delay 60ms 20ms distribution normal loss 5%"))?;
            }
            _ => {}
        }
        Ok(router_ip)
    }

    fn router(&self, name: &str, net: &str) -> Result<(), CliError> {
        docker(&["run", "-d", "--name", name, "--cap-add", "NET_ADMIN", "--sysctl", "net.ipv4.ip_forward=1", "--network", net, ROUTER_IMAGE])?;
        Ok(())
    }

    fn client(&self, name: &str, net: &str, lan: Option<(&str, &str)>) -> Result<(), CliError> {
        let mut args: Vec<String> = ["run", "-d", "--name", name, "--cap-add", "NET_ADMIN", "--network", net, "--dns", "1.1.1.1", "--shm-size", "512m"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        if let Some((ip, _)) = lan {
            args.extend(["--ip".into(), ip.to_string()]);
        }
        for m in &self.mounts {
            args.extend(["-v".into(), m.clone()]);
        }
        args.extend(["--add-host".into(), "host.docker.internal:host-gateway".into(), CLIENT_IMAGE.into()]);
        docker(&args.iter().map(String::as_str).collect::<Vec<_>>())?;
        if let Some((_, gw)) = lan {
            docker(&["exec", name, "ip", "route", "replace", "default", "via", gw])?;
        }
        Ok(())
    }

    /// The interface of `container` that sits on docker network `net`.
    fn iface(&self, container: &str, net: &str) -> Result<String, CliError> {
        let ip = docker(&["inspect", "-f", &format!("{{{{(index .NetworkSettings.Networks \"{net}\").IPAddress}}}}"), container])?;
        let out = docker(&["exec", container, "sh", "-c", &format!("ip -o -4 addr | awk '$4 ~ /^{ip}\\// {{print $2}}'")])?;
        if out.is_empty() {
            return Err(CliError::new("topology", format!("{container} has no interface on {net}"), "run `partii torture clean` and retry"));
        }
        Ok(out)
    }

    /// Move the guest to the other of its two LANs (new address, new NAT
    /// mapping): lan2 → lan9 on one trial, lan9 → lan2 on the next.
    pub fn switch_guest_network(&self) -> Result<(), CliError> {
        let old = docker(&["inspect", "-f", "{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}", &self.guest])?;
        let on_spare = old.split_whitespace().any(|n| n.ends_with("-lan9"));
        let n = if on_spare { 2 } else { 9 };
        let target = format!("{}-lan{n}", self.prefix);
        // Docker sets its own gateway on connect; clear ours first or it refuses.
        let _ = docker(&["exec", &self.guest, "ip", "route", "del", "default"]);
        docker(&["network", "connect", "--ip", &self.ip(n, 10), &target, &self.guest])?;
        docker(&["exec", &self.guest, "ip", "route", "replace", "default", "via", &self.ip(n, 2)])?;
        for net in old.split_whitespace().filter(|x| *x != target) {
            docker(&["network", "disconnect", net, &self.guest])?;
        }
        Ok(())
    }

    pub fn pause_guest(&self, secs: u64) -> Result<(), CliError> {
        docker(&["pause", &self.guest])?;
        std::thread::sleep(std::time::Duration::from_secs(secs));
        docker(&["unpause", &self.guest])?;
        Ok(())
    }

    /// Remove every container and network with this prefix (ignores errors).
    pub fn down(&self) {
        let p = &self.prefix;
        if let Ok(ids) = docker(&["ps", "-aq", "--filter", &format!("name=^{p}-")]) {
            let ids: Vec<&str> = ids.split_whitespace().collect();
            if !ids.is_empty() {
                let mut a = vec!["rm", "-f"];
                a.extend(ids);
                let _ = docker(&a);
            }
        }
        if let Ok(nets) = docker(&["network", "ls", "-q", "--filter", &format!("name=^{p}-")]) {
            for n in nets.split_whitespace() {
                let _ = docker(&["network", "rm", n]);
            }
        }
    }
}

fn sh(container: &str, cmd: &str) -> Result<String, CliError> {
    docker(&["exec", container, "sh", "-c", cmd])
}

/// NAT the router's traffic out of `iface`. `symmetric` randomises the
/// source port per destination (what CGNATs and strict firewalls do), so a
/// mapping learned through STUN is useless to any other peer.
fn nat(router: &str, iface: &str, symmetric: bool) -> Result<(), CliError> {
    let extra = if symmetric { " --random-fully" } else { "" };
    sh(router, &format!("iptables -t nat -A POSTROUTING -o {iface} -j MASQUERADE{extra}"))?;
    Ok(())
}
