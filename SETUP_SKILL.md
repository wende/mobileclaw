# MobileClaw Setup Skill

You are helping a user set up **MobileClaw** — a mobile chat UI that connects to an OpenClaw backend.

## Step 0: Ask the User

Before starting, ask:

1. **Where is your OpenClaw running?** (same machine / another machine on your network / remote server)
2. **Will you access MobileClaw from the same machine, or from your phone/tablet too?**

---

## Step 1: Install and Run

```bash
git clone https://github.com/wende/mobileclaw
cd mobileclaw
pnpm install
pnpm build
pnpm start
```

Opens at [http://localhost:3000](http://localhost:3000). You'll see a setup dialog.

**No backend yet?** Add `?demo` to the URL to try it with fake data: [http://localhost:3000?demo](http://localhost:3000?demo)

---

## Step 2: Connect to OpenClaw

Make sure your OpenClaw gateway is running:

```bash
curl -s http://127.0.0.1:18789/v1/models | head -c 200
```

In the MobileClaw setup dialog:

1. Enter `ws://127.0.0.1:18789`
2. If your gateway uses auth, enter the token (from `~/.openclaw/openclaw.json` → `gateway.auth.token`)
3. Click **Connect**

Settings are saved in your browser — you won't need to re-enter them.

---

## Step 3: Access from Your Phone

By default the dev server only listens on localhost. To access from other devices:

### 3a. Start on all interfaces

```bash
pnpm build
npx next start --hostname 0.0.0.0
```

### 3b. Find your machine's IP

```bash
# macOS
ipconfig getifaddr en0

# Linux
hostname -I | awk '{print $1}'
```

### 3c. Open on your phone

Browse to `http://<your-ip>:3000` (e.g. `http://192.168.1.42:3000`).

### 3d. Fix the backend URL

**This is the part people miss.** Your phone's browser connects to OpenClaw *directly* — not through MobileClaw. So in the setup dialog on your phone, enter the machine's LAN IP, not localhost:

- `ws://192.168.1.42:18789` (not `ws://127.0.0.1:18789`)

OpenClaw must also listen on `0.0.0.0`. Check `~/.openclaw/openclaw.json`:

```json
{ "gateway": { "host": "0.0.0.0" } }
```

Restart the gateway after changing this.

### 3e. Using Tailscale instead of LAN

If your devices are on different networks, [Tailscale](https://tailscale.com) is the easiest solution (free for personal use).

1. Install Tailscale on both the server machine and your phone
2. Sign in with the same account on both
3. Find the Tailscale hostname: `tailscale status` (e.g. `my-macbook`)
4. Open `http://my-macbook:3000` on your phone
5. In the setup dialog: `ws://my-macbook:18789`

Same rules apply — OpenClaw must bind to `0.0.0.0` and you use the Tailscale hostname instead of a LAN IP.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Setup dialog keeps reappearing | Clear `openclaw-*` keys from localStorage |
| WebSocket fails | Use `ws://` not `http://`. Check gateway is running. |
| Can't reach from phone | Backend must bind `0.0.0.0`. Use LAN IP, not `localhost`. Check firewall. |
| Mixed content error (HTTPS page + ws://) | Serve MobileClaw over HTTP too, or use `wss://` |
