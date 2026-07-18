# Diagnosing 502 Host Errors with Cloudflare Tunnel and Dockerized Nginx Origin

## Overview

This report analyzes intermittent `502 Bad Gateway – Host Error` responses observed when accessing a SOC dashboard through a Cloudflare Tunnel that terminates to a Dockerized Nginx origin (`soc-nginx-proxy`) on port 80.[^1][^2]
It focuses on Docker networking, ingress configuration, and tunnel service URL wiring as the main causes, and provides a Principal Engineer–level troubleshooting prompt to systematically resolve the issue.

## Current Architecture

### Docker Compose networking

- Two bridge networks are defined: `internal-mesh` (air‑gapped, `internal: true`) and `public-ingress` (for ingress/tunnel traffic).[^3]
- `soc-frontend` (Nginx) attaches to both networks and exposes ports `80:80` and `443:443` to the host.[^3]
- `cloudflared` attaches only to `public-ingress` and points its ingress rule at `http://soc-nginx-proxy:80`, using container‑name routing within the Docker network.[^4][^5]

### Cloudflare Tunnel configuration

- The tunnel pre-check logs show healthy DNS resolution, UDP and TCP connectivity, and Cloudflare API reachability, with `http2` selected as the suggested transport.[^4][^1]
- The ingress configuration maps the public hostname to the Nginx service name on port 80 inside Docker:
  - `hostname: socanalyst.raymundgerardestaca.dev`
  - `service: http://soc-nginx-proxy:80`
  - Fallback: `service: http_status:404` for unmatched routes.[^6]

This indicates the tunnel itself is correctly registered with Cloudflare and able to reach the origin service in principle; the `502 Host Error` suggests periodic failures from origin or connectivity glitches between `cloudflared` and `soc-nginx-proxy`.

## Nature of the 502 Host Error

### Cloudflare’s interpretation of 502

Cloudflare documentation explains that a `502`/`504` may originate either from the origin web server or Cloudflare’s edge.[^7][^1]
For Cloudflare Tunnel specifically, a `502 Host Error` with messaging like “Unable to reach the origin service. The service may be down or not responding to traffic from cloudflared” generally means `cloudflared` cannot reliably reach the configured origin service URL.[^8][^1]

### Why it is intermittent

Common causes of **intermittent** 502s in Tunnel setups include:[^9][^8][^4]
- Origin container restarting or briefly being unavailable (e.g., Docker compose restart, Nginx reloads).
- Network isolation misconfiguration where `cloudflared` and origin sometimes do not share the same Docker network or cannot consistently resolve the origin’s container name.[^8][^4]
- HTTP vs HTTPS mismatch or TLS verification issues on the origin endpoint.
- Resource constraints at origin (high CPU or memory, slow response times) causing occasional timeouts.

Since your `cloudflared` logs show stable tunnel registration and correct ingress mapping, the most likely issues are transient origin availability, Docker networking edge cases, or Nginx configuration limitations rather than a problem with Cloudflare’s edge.[^2][^4]

## Key Checks for This Architecture

Based on Cloudflare’s tunnel troubleshooting guidance, the following checks are critical for this specific Docker setup:[^10][^4][^8]

1. **Verify origin container health**:
   - Confirm `soc-nginx-proxy` is consistently `Up` in `docker ps` during incidents.
   - Tail Nginx logs for 502/504 or upstream/connection errors.

2. **Verify Docker network membership**:
   - Confirm both `cloudflared` and `soc-nginx-proxy` share the `public-ingress` network.
   - Ensure the service name `soc-nginx-proxy` resolves correctly within that network.

3. **Validate tunnel service URL**:
   - Confirm the tunnel’s public hostname maps to `http://soc-nginx-proxy:80` (HTTP) and not an incorrect host or port.[^10][^4]
   - Avoid `localhost` in the service URL; `localhost` inside the `cloudflared` container refers to itself, not the Nginx container.[^10][^8]

4. **Check SSL/TLS mode and offloading**:
   - Ensure Cloudflare SSL/TLS mode is `Full` or `Full (strict)`, matched to your origin configuration, and not `Flexible`, which can induce redirect loops or 502s in some Tunnel + proxy setups.[^11][^2]
   - Confirm Nginx is not re‑redirecting HTTP → HTTPS in a way that conflicts with Cloudflare’s offload model (you already removed aggressive redirects, which is correct).

5. **Check origin response behavior**:
   - Confirm Nginx returns valid HTTP responses (no broken gzip/compression with incorrect `Content-Length` that can cause 502s at Cloudflare).[^1]
   - Monitor origin CPU/memory to ensure it is not intermittently overloaded.[^2]

## Principal Engineer Troubleshooting Prompt (Markdown)

```text
You are acting as a Principal DevOps Engineer and Principal Application Security Engineer diagnosing intermittent 502 Bad Gateway (Host Error) issues for a Cloudflare Tunnel pointing to a Dockerized Nginx origin.

Architecture summary:
- docker-compose.yml defines two networks: internal-mesh (internal: true) and public-ingress.
- cloudflared runs as a container on public-ingress with TUNNEL_TRANSPORT_PROTOCOL=http2 and ingress mapping:
  - hostname: socanalyst.raymundgerardestaca.dev
  - service: http://soc-nginx-proxy:80
- soc-frontend (soc-nginx-proxy) runs Nginx, attaches to both public-ingress and internal-mesh, and exposes ports 80:80 and 443:443.
- core-ingest, soc-backend, clickhouse-server, and postgres run on internal-mesh.

Intermittent symptom:
- Some requests succeed; others return Cloudflare-branded 502 Host Error.
- cloudflared logs show the tunnel is healthy, DNS resolution and HTTP/2 connectivity pass pre-checks.

Your tasks:

1. **Verify origin container health and availability**
   - Check that the Nginx container is truly up and responding during 502 incidents:
     - Run `docker ps | grep soc-nginx-proxy` and ensure status is "Up".
     - From the Docker host, curl the origin directly:
       - `curl -I http://localhost:80`
       - `curl -I http://soc-nginx-proxy:80` from another container on public-ingress.
   - Inspect Nginx error/access logs for upstream connection failures or 5xx responses.

2. **Verify Docker network membership and name resolution**
   - Confirm cloudflared and soc-nginx-proxy share the same Docker network:
     - `docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' soc-cloudflared-edge`
     - `docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' soc-nginx-proxy`
   - Ensure `public-ingress` appears for both.
   - From cloudflared container, check name resolution:
     - `docker exec -it soc-cloudflared-edge sh`
     - `curl -I http://soc-nginx-proxy:80`
     - If this fails, document the exact error (connection refused, timeout, DNS failure).

3. **Validate tunnel service URL and Cloudflare settings**
   - In Cloudflare Zero Trust → Tunnels, confirm the Public Hostname entry for socanalyst.raymundgerardestaca.dev uses:
     - Service: `http://soc-nginx-proxy:80` (not localhost, not https unless origin is configured for TLS).
   - In the Cloudflare Dashboard → SSL/TLS → Overview:
     - Ensure SSL mode is set to `Full` or `Full (strict)` and matches the origin's TLS behavior.
   - Confirm no conflicting HTTP→HTTPS redirect rules exist at Nginx that could create loops.

4. **Check for origin resource constraints or timeouts**
   - During a 502 event, check origin system metrics:
     - CPU, memory, and disk IO on the Docker host.
     - Container-specific resource usage (docker stats).
   - Ensure Nginx worker processes are not crashing or restarting.
   - If requests are long-running, verify Nginx and Cloudflare timeouts are sufficiently high.

5. **Tune cloudflared originRequest settings if needed**
   - If logs show slow TCP/TLS handshakes or frequent reconnects, consider adding originRequest tuning in cloudflared config:
     - `connectTimeout`, `tlsTimeout`, `tcpKeepAlive`, and `keepAliveTimeout`.
   - Ensure these settings are aligned with Nginx timeouts and do not prematurely drop connections.

6. **Confirm no localhost or wrong-port assumptions exist**
   - Verify that neither the tunnel config nor docker-compose uses `localhost` as the origin service URL inside cloudflared; it must use the container name or host IP reachable from cloudflared.[reference: Cloudflare Tunnel docs and common errors]
   - Confirm port 80 in Nginx is the correct listener for HTTP, and that Cloudflare Tunnel is not pointing to a closed or misconfigured port.

7. **Produce a concise incident runbook**
   - Document a step-by-step checklist for future 502 incidents:
     - Check docker ps for soc-nginx-proxy and cloudflared.
     - Curl origin from host and cloudflared container.
     - Inspect Nginx logs and system metrics.
     - Validate Cloudflare SSL/TLS mode and Tunnel service mapping.
     - Note timestamp and URL, and gather Cloudflare trace (`/cdn-cgi/trace`) for deeper analysis.

Return:
- A diagnosis of whether the root cause is origin availability, Docker networking, tunnel config, or resource/timeouts.
- A set of configuration changes (if any) to docker-compose.yml, Nginx, cloudflared config, or Cloudflare Dashboard.
- A finalized incident runbook developers and SREs can follow.
```

## Recommended Configuration and Operational Safeguards

Beyond the troubleshooting prompt, several safeguards can improve resilience:

- Ensure **cloudflared and Nginx remain on the same ingress network** and that no future refactor removes `soc-nginx-proxy` from `public-ingress`, which would break container‑name routing.[^4][^10]
- Keep Cloudflare SSL mode at `Full` or `Full (strict)` aligned with your origin’s TLS configuration to avoid redirect loops or mismatches.[^11][^2]
- Avoid `localhost` in tunnel service URLs; always use container names or host IPs reachable from the `cloudflared` container.[^8][^10]
- Monitor Nginx and Docker host resource usage to catch overload‑induced timeouts early.[^2]

With these checks and the provided prompt, you can systematically identify whether the 502 Host Error stems from origin downtime, Docker networking, miswired tunnel service URLs, or resource constraints, and then harden the configuration accordingly.

---

## References

1. [Error 502 or 504 · Cloudflare Support docs](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-502-504/) - An HTTP 502 or 504 error indicates that Cloudflare is unable to establish contact with your origin w...

2. [How To Fix Bad Gateway 502 Error From Cloudflare In 2026](https://www.youtube.com/watch?v=u9qU3v5oq4c&vl=en) - A 502 almost always points to an issue with your hosting server—not Cloudflare. Enable server monito...

3. [docker-compose-2.yml](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/127745683/85bb0637-d37e-4a50-bb7f-83e2f1c2fb9f/docker-compose-2.yml?AWSAccessKeyId=ASIA2F3EMEYESAQFNWRY&Signature=kNXTyTlF6WsvoJRpi8ZMpnCtEC8%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEJn%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMSJIMEYCIQCzVe8Nm%2BheR9vPG9IzHEY%2BGrfNCzA7uC77XJbVAxHPnQIhAPytBsgAjw1B27ioERhJMWEzVwzm58KwDtNIk%2F6rVlHVKvMECGEQARoMNjk5NzUzMzA5NzA1IgyjFGiaXut%2BF6VwdJEq0AThgGZ7y%2F2jWoaz5K8MGL0U1Tgm%2BO5vpjA6nCsKEJBqr05vwYTmFIEN5AuZjLKcF9AktD9bfNMzk9X08JRgdrj%2FQt7izxUn%2BU2bbyWGa6WjlxzWmNrFeiEurHq4nmEPRpq3areRw1ewww5d07Qqshv0BzThQ0LAbO1RcD%2BqbGPQgkpRtUtrZerHAqEqc8D7Q%2F8zCxaGr98OnrrHOsedeqK396FUHPpiljtKlxrYuJE%2B7sp2ZNvPdkCLWPuv7n3FZ7tv%2F%2BV%2FxfvJIqJfIdo7bEWg7fe%2B8S2ohgj8seYECMTja%2FZHmXoKuxBe8oFiqb9E3mv7MMszOmdcV6%2BSflhpoE0qib%2Bpze%2FHS1BOwDRwQGXKAFFDeiynlTB8K6zrDxxvFlhl%2FJzBYjFpZKz3opKOZn%2Fd1E%2BLiKQehmsenx19kRkOGmXcCIY7JiDDuiwgCyxWiayabI3Ie%2FHQ4tTiqNo0%2BqvHJ0Jm%2BebOUnM1kFspz6IqFKmc6AM6ZNE1VGhF%2F3yr0aVtODc8m8xR3vrwyNYVj8kkl%2FfA1CvPtMV4OxK9oKw4ttsV1gYsXDc6VBW05VLZHlSpUcAPBoEnsrThsiEAAin%2B%2BKkdBiMWtWNLC54NaKv2Dr64FB8Ya2oYkKzVKyraWxvD4kNFblmPkon1m0s9ZVrUIyoLFb%2B2GkfHQGrZoZCMYw5Ch8igYHv5ZL313LQJvgOaatB5TWvaQp0MB1BaGTw5cEhhHSZIsK%2BOltUOClpVriq07TKqWoqk7mf91mIuxQO%2B2K6DzDQf8v7ObYCbYN79MLGm6dIGOpcB2w09hoAHZQKcMqff8dbNjmxqEt%2BTcksjBg75jCCDYZ3kDQM8%2BmAMLNgOiCG2WJ695llmvIjACDAASu3heHBkF6C5YO1Qkme%2BsSl7sI50jsFdNng%2Bm%2F2vsNE65ocQYKKjE0inTI3twCX8Ozd0jp0oBWadA9E2d6hH%2FrooK1KqomBuadb6rlO0AZ0vuv0G0Q8bKB6sIeMUtg%3D%3D&Expires=1784307972) - # ==============================================================================
# 1. 🌐 COMPONENT PL...

4. [How to Fix 502 Bad Gateway Errors with Cloudflare Tunnel ...](https://oneuptime.com/blog/post/2026-03-20-cloudflare-tunnel-502-portainer/view) - Step 1: Check Portainer Is Running · Step 2: Verify cloudflared Can Reach Portainer · Step 3: Check ...

5. [502 Bad Gateway for Documenso behind Cloudflare ...](https://github.com/Dokploy/dokploy/discussions/2173) - To Reproduce

Description

I’m trying to expose my Dokploy-deployed Documenso app at sign.vexelstudi...

6. [AIO + cloudflare tunnel 502 error](https://help.nextcloud.com/t/aio-cloudflare-tunnel-502-error/233999) - Error code 502 Host Error ・ this might be due to the tunnel config or other networking problems. you...

7. [Cloudflare 5xx errors](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/) - When troubleshooting most 5XX errors, the correct course of action is to first contact your hosting ...

8. [502 Bad Gateway with minimalistic Docker-Ubuntu-HTTP ...](https://community.cloudflare.com/t/502-bad-gateway-with-minimalistic-docker-ubuntu-http-setup/507564) - The issue is related to using localhost within the cloudflared container. In this case, localhost wi...

9. [One of my Cloudflare Tunnels is returning a Bad Gateway ...](https://community.cloudflare.com/t/one-of-my-cloudflare-tunnels-is-returning-a-bad-gateway-error/483145) - For a 502 Bad Gateway on a tunnel, you will need to check the logs for cloudflared. Basically it mea...

10. [🐛Unable to reach the origin service. The service may ...](https://github.com/cloudflare/cloudflared/issues/976) - ,Error 502 reported when accessing the domain name. due to cloudflared container was not able to con...

11. [502 error with Cloudflare zero trust tunnel](https://www.reddit.com/r/CloudFlare/comments/vbwm76/502_error_with_cloudflare_zero_trust_tunnel/) - Under overview set your SSL to full strict. Then head back over to your Zero Zone Trust control pane...

