# MobileClaw Marketing Campaign

**Positioning**: The mobile client OpenClaw deserves. OpenClaw's official iOS
app requires building from Xcode. MobileClaw is a PWA — open a URL, add to
home screen, done. Watch your agent work from your phone.

**Repo**: https://github.com/wende/mobileclaw
**Live Demo**: https://mobileclaw.vercel.app?demo
**Screenshots**: `docs/screenshots/`

---

## 0. Pre-Launch: Ecosystem Listings (do these first)

### awesome-openclaw PR

Submit a PR to https://github.com/SamurAIGPT/awesome-openclaw adding
MobileClaw to the "Web Clients & UIs" section under Community Projects:

```markdown
- [MobileClaw](https://github.com/wende/mobileclaw) — Mobile-first PWA chat client for OpenClaw with live tool calls, inline diffs, sub-agent activity, and reasoning blocks. Also supports LM Studio.
```

Also submit to:
- https://github.com/thewh1teagle/awesome-openclaw
- https://github.com/rohitg00/awesome-openclaw

These PRs create permanent backlinks and show up in Google results for
"openclaw mobile client."

### GitHub Repo Topics

Add these topics to the repo (Settings → Topics):
```
openclaw, openclaw-client, ai-agent, mobile, pwa, chat-ui, nextjs,
tailwindcss, tool-use, streaming, typescript, open-source, lm-studio
```

Lead with `openclaw` — it's the discovery keyword.

Pin the repo on your GitHub profile.

Add a social preview image (Settings → Social Preview) — 1280x640 banner
with the logo + "Mobile client for OpenClaw" tagline.

---

## 1. Reddit — r/clawdbot (OpenClaw's subreddit)

**When**: You already posted on r/openclaw. If r/clawdbot is the more active
sub, post there too. Weekday, daytime.

**Title**:
```
MobileClaw — a PWA that lets you watch your OpenClaw agent work from your phone (tool calls, diffs, sub-agents, reasoning)
```

**Body**:
```
I built a mobile-first chat client for OpenClaw that focuses on one thing:
showing you exactly what your agent is doing, on your phone.

**The problem**: OpenClaw's official iOS app requires building from Xcode.
I wanted to pull out my phone and check on a long-running agent without
touching a laptop.

**The solution**: MobileClaw is a PWA — open the URL, tap "Add to Home
Screen", done. No Xcode, no TestFlight, no App Store.

**What you see on your phone:**
- Tool calls with live running/success/error states
- Inline diffs when the agent edits files (red/green, right in the chat)
- Sub-agent activity feed — watch spawned agents reason and call tools
- Expandable thinking blocks with reasoning duration
- Full markdown rendering with code blocks and one-tap copy
- Push notifications when the agent finishes

It connects to your OpenClaw gateway via WebSocket — same protocol, just
a better mobile experience.

**Try the demo** (no OpenClaw instance needed):
https://mobileclaw.vercel.app?demo

Type "agent" to see sub-agent spawning, "edit" for inline diffs, "think"
for reasoning blocks.

**Connect to your gateway:**
Point it at your OpenClaw gateway URL + auth token and you're in.

GitHub: https://github.com/wende/mobileclaw

[screenshot of hero-dark.png]
[screenshot of feature-edit-diff.png]
[screenshot of feature-subagent.png]

What features would make this more useful for your OpenClaw workflow?
```

---

## 2. OpenClaw Discord (#showcase or #community)

**Server**: https://discord.com/invite/openclaw (~13k members)

**Message**:
```
Hey everyone! I built MobileClaw — a mobile-first PWA client for OpenClaw.

The pitch: open a URL on your phone, add to home screen, and you have a
native-feeling app that shows your agent's tool calls, file diffs,
sub-agent activity, and reasoning chains streaming in real time.

No Xcode build required, no App Store — just a URL.

**Live demo** (works without a gateway): https://mobileclaw.vercel.app?demo
**GitHub**: https://github.com/wende/mobileclaw

I'd love to know what features matter most for monitoring OpenClaw agents
on mobile. What do you wish you could see from your phone?
```

*Attach: hero-dark.png + feature-subagent.png*

---

## 3. Hacker News — Show HN

**When**: Weekday, 8-10am EST

**Title** (80 chars max):
```
Show HN: MobileClaw – Mobile PWA client for OpenClaw with live tool calls
```

**Body**:
```
I built a mobile-first PWA client for OpenClaw (https://github.com/openclaw/openclaw).

OpenClaw is amazing but the official iOS app requires building from Xcode.
I wanted to check on my agents from my phone — see what files they're
editing, which tools they're calling, watch sub-agents spawn and work —
without opening a laptop.

MobileClaw connects to your OpenClaw gateway via WebSocket and renders
everything in real time:

- Tool call pills with running/success/error states and inline diffs
- Sub-agent activity feed with live reasoning + tool call streams
- Expandable chain-of-thought blocks with duration badges
- Full markdown with syntax-highlighted code blocks
- Push notifications when the agent finishes
- PWA — add to home screen, loads instantly, works offline

It also supports LM Studio for local model inference if you want to use
it standalone.

Try the demo without any backend: https://mobileclaw.vercel.app?demo

GitHub: https://github.com/wende/mobileclaw

Tech: Next.js 16, Tailwind v4, TypeScript, zero component libraries.
Every animation is hand-rolled — CSS grid transitions, ResizeObserver
for smooth streaming height, scroll-driven CSS variable animations.

Solo developer. Happy to answer questions about the WebSocket protocol
integration or the animation architecture.
```

---

## 4. Reddit — r/clawdbot (cross-post angle: workflow)

If you already did a "launch" post, follow up with a workflow post:

**Title**:
```
How I use MobileClaw to monitor my OpenClaw agents from my phone — my mobile workflow
```

**Body**:
```
A few days ago I shared MobileClaw here. Wanted to follow up with how I
actually use it day-to-day with OpenClaw.

**My setup:**
I run OpenClaw on a home server. During the day, I kick off long-running
tasks (code reviews, research, file refactoring) and check in from my
phone using MobileClaw.

**What the mobile UI gives me that the web UI doesn't:**
1. Push notifications when the agent finishes — I don't have to keep
   checking
2. Sub-agent activity feed — I can see agents spawning and working
   without scrolling through a terminal
3. Inline diffs — when the agent edits a file, I see the red/green diff
   right in the chat on my phone. I can review changes while walking
4. It's a PWA on my home screen — one tap to check agent status

**What I'm building next:**
- Session picker (switch between OpenClaw sessions)
- Agent interruption (stop/redirect from mobile)

What's your mobile workflow with OpenClaw? Are you just using
Telegram/WhatsApp channels, or something else?
```

---

## 5. Twitter/X Thread

**Tweet 1** (hook + video/GIF):
```
OpenClaw is incredible but checking on your agents from your phone
is painful.

So I built MobileClaw — a mobile PWA client that shows tool calls,
inline diffs, sub-agents, and reasoning chains streaming live.

No Xcode, no App Store. Just a URL.

https://mobileclaw.vercel.app?demo
```
*Attach: screen recording GIF of the demo*

**Tweet 2**:
```
The problem: OpenClaw's official iOS app requires building from
Xcode. I wanted to check on a long-running agent from the bus.

The solution: a PWA. Open URL → Add to Home Screen → done.
Connects to your gateway via WebSocket.
```

**Tweet 3**:
```
What you see on your phone:

→ Tool calls with live status (running → success/error)
→ Inline diffs when the agent edits files
→ Sub-agent activity streaming in real time
→ Expandable reasoning blocks
→ Push notifications when the agent finishes
```
*Attach: feature-edit-diff.png + feature-subagent.png*

**Tweet 4**:
```
Also works with LM Studio if you want a standalone mobile chat UI
for local models. But the killer feature is monitoring OpenClaw
agents from your pocket.

MIT licensed. Open source.
https://github.com/wende/mobileclaw
```

---

## 6. Reddit — r/selfhosted

**Title**:
```
MobileClaw — a PWA to monitor your self-hosted OpenClaw agent from your phone (live tool calls, diffs, sub-agents)
```

**Body**:
```
If you're running OpenClaw on your home server, you probably want to check
on it from your phone. The official iOS app requires building from Xcode.

MobileClaw is a PWA that connects to your OpenClaw gateway and shows you
everything the agent is doing in real time:

- Tool calls with status indicators
- Inline code diffs for file edits
- Sub-agent activity feed
- Reasoning chains
- Push notifications when tasks complete

**Setup:**
```bash
git clone https://github.com/wende/mobileclaw
cd mobileclaw && pnpm install && pnpm dev
```

Or deploy to Vercel/your server and point it at your gateway.

**Try the demo** (no backend needed): https://mobileclaw.vercel.app?demo

Also supports LM Studio for local LLM inference.

GitHub: https://github.com/wende/mobileclaw

[screenshot of hero-dark.png]
[screenshot of feature-subagent.png]

MIT licensed, zero component libraries, Next.js 16 + Tailwind v4.
```

---

## 7. Reddit — r/LocalLLaMA (secondary angle)

**Title**:
```
Built a mobile PWA for OpenClaw that also works with LM Studio — inline diffs, tool calls, reasoning blocks on your phone
```

**Body**:
```
Hey r/LocalLLaMA — I built MobileClaw, primarily as a mobile client for
OpenClaw, but it also connects to LM Studio for local model chat.

The LM Studio integration:
- Auto-fetches your loaded models
- Streams via OpenAI-compatible API
- Parses <think> tags for reasoning display
- Shows thinking duration badges

But the real power is the OpenClaw integration — live tool calls,
inline diffs, sub-agent monitoring, push notifications.

It's a PWA — install on your phone from the browser, works offline.

**Try it**: https://mobileclaw.vercel.app?demo
**Source**: https://github.com/wende/mobileclaw
```

---

## 8. Product Hunt

**When**: Tuesday or Wednesday, schedule for 12:01am PST
**Launch AFTER the Reddit/HN posts** for social proof.

**Tagline** (60 chars):
```
The mobile client your OpenClaw agent deserves
```

**Description**:
```
MobileClaw is a mobile-first PWA client for OpenClaw that shows you
everything your AI agent is doing — tool calls, inline code diffs,
reasoning chains, and sub-agent activity — streaming in real time on
your phone.

OpenClaw's official iOS app requires building from Xcode. MobileClaw
is just a URL — open it, add to home screen, connect to your gateway.

Also works standalone with LM Studio for local model inference.
Zero component libraries. Every animation hand-crafted for mobile.
```

**Maker Comment**:
```
I built MobileClaw because I run OpenClaw on a home server and got
tired of opening my laptop to check on long-running agents. I wanted
to pull out my phone and instantly see what the agent is doing —
which files it's editing, what tools it's calling, how it's reasoning.

The demo works without a backend:
https://mobileclaw.vercel.app?demo

Type "agent" to see sub-agent spawning, "edit" for inline diffs,
or "think" for reasoning blocks.

What features would make you use this daily?
```

**Topics**: `Artificial Intelligence`, `Developer Tools`, `Open Source`

---

## 9. GitHub Discussions on openclaw/openclaw

Post in https://github.com/openclaw/openclaw/discussions under "Show and Tell":

**Title**:
```
MobileClaw — a mobile PWA client for OpenClaw
```

**Body**:
```
Built a mobile-first PWA that connects to your OpenClaw gateway via
WebSocket. Focused on giving you visibility into what your agent is
doing, from your phone.

Features:
- Live tool call pills (running/success/error)
- Inline diffs for file edits
- Sub-agent activity feed
- Reasoning blocks with duration
- Push notifications
- PWA — works offline, installable

Demo: https://mobileclaw.vercel.app?demo
GitHub: https://github.com/wende/mobileclaw

Would love feedback from the OpenClaw community on what's most
useful for mobile monitoring.
```

---

## Posting Schedule

| Day | Channel | Why |
|-----|---------|-----|
| Day 0 | awesome-openclaw PRs + GitHub topics | Permanent backlinks, zero effort |
| Day 0 | OpenClaw Discord #showcase | Warm, receptive audience |
| Day 0 | OpenClaw GitHub Discussions | Gets indexed, permanent |
| Day 1 (Tue) | r/clawdbot | Core audience, highest conversion |
| Day 1 | Hacker News (Show HN) | Fastest feedback, broad reach |
| Day 1 | Twitter/X thread | Amplifies HN post |
| Day 3 | r/selfhosted | Self-hosted OpenClaw users |
| Day 4 | r/LocalLLaMA | LM Studio angle, secondary audience |
| Day 5 | Product Hunt | Launch with social proof from earlier posts |
| Day 7+ | r/clawdbot workflow post | Follow-up for sustained engagement |

---

## Priority: Create a Screen Recording

**Before posting anywhere**, record a 15-30 second screen capture on your
phone of the live demo:
1. Open https://mobileclaw.vercel.app?demo
2. Type "agent" — show the sub-agent spawning and streaming
3. Type "edit" — show the inline diff expanding

Convert to GIF:
```bash
ffmpeg -i recording.mov -vf "fps=15,scale=350:-1" -loop 0 demo.gif
```

This GIF is worth more than every word in this document. Attach it to
the HN post, every Reddit post, and the first tweet.

---

## Tips

- **Reply to every comment** in the first 2 hours — engagement boosts
  visibility on all platforms
- **Don't cross-post the same day** — stagger by 1-2 days minimum
- **The demo link is your best weapon** — zero friction, no signup, no
  install, no backend. Lead with it everywhere
- **Anchor to OpenClaw's brand** — "mobile client for OpenClaw" piggybacks
  on their 215k-star gravity. People searching for OpenClaw mobile solutions
  will find you
- **Ask questions at the end** — "What would make this useful for your
  workflow?" drives comments, which drives visibility
- **The "no Xcode" angle is gold** — OpenClaw's official iOS app requiring
  a source build from Xcode is a real pain point. Lead with the contrast:
  "just a URL" vs "build from Xcode"
