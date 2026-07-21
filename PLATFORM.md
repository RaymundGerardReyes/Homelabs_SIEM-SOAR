# Local Development Connectivity Guide

Because this project targets PaaS and "PaaS-like" remote droplets (Tier P2), we **never** expose production databases (Postgres, ClickHouse) directly on public IPs using just password authentication.

To connect to remote services securely from your local development machine, use one of the two methods below:

## Method 1: Tailscale (Recommended)

Tailscale operates a zero-config WireGuard mesh. By installing the Tailscale client locally, your development machine joins the same private network as the Tier P2 droplets.

1. Install Tailscale on your local machine (Windows/Mac/Linux).
2. Authenticate to the team's Tailscale network.
3. You can now access remote databases using their private `100.x.y.z` IP addresses (e.g., `100.64.0.2:5432`) exactly as if they were local.

**Why this is preferred:** It provides a seamless "always-on" experience for debugging without manual tunnel setup, and allows cross-communication with all Tier P2 nodes simultaneously.

## Method 2: SSH Port-Forwarding (Low-Overhead)

If you prefer not to install Tailscale, you can temporarily bridge your local machine to the remote droplet via an SSH tunnel. 

1. Ensure you have SSH key access to the remote Tier P2 droplet.
2. Run the following command to bind the remote Postgres port to your `localhost`:

```bash
ssh -L 5433:localhost:5432 root@<droplet-public-ip>
```

3. You can now connect your local DBeaver or scripts to `localhost:5433`.

**When to use this:** Ideal for quick, one-off database queries when you don't want to join the VPN mesh permanently.
