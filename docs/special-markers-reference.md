# Special Markers & Directives Reference

## Agent Reply Tokens

Defined in `src/auto-reply/tokens.ts`.

| Token | Constant | Meaning |
|---|---|---|
| `NO_REPLY` | `SILENT_REPLY_TOKEN` | Agent decides not to send a message. The reply is suppressed entirely. |
| `HEARTBEAT_OK` | `HEARTBEAT_TOKEN` | During heartbeat runs, signals "nothing needs attention." The reply is suppressed. Outside heartbeat runs, stray `HEARTBEAT_OK` tokens are stripped from the reply. |

## Agent Output Inline Directives

Defined in `src/utils/directive-tags.ts`. These `[[ ]]` tags can appear in the agent's reply text.

| Tag | Effect |
|---|---|
| `[[audio_as_voice]]` | Marks the reply audio as a voice note (e.g., Telegram voice messages) |
| `[[reply_to_current]]` | Reply to (quote) the triggering message |
| `[[reply_to: <id>]]` | Reply to a specific message by ID |

## LINE Channel Directives

Defined in `src/auto-reply/reply/line-directives.ts`. Parsed from reply text when targeting LINE.

| Tag | Effect |
|---|---|
| `[[quick_replies: opt1, opt2, ...]]` | Renders quick reply buttons |
| `[[location: title \| addr \| lat \| lon]]` | Sends a location message |
| `[[confirm: question \| yes \| no]]` | Renders a confirm template |
| `[[buttons: title \| text \| btn1:data1, ...]]` | Renders a button template |
| `[[media_player: title \| artist \| source \| imgUrl \| playing/paused]]` | Flex media player card |
| `[[event: title \| date \| time \| location \| desc]]` | Flex event card |
| `[[agenda: title \| ev1:time1, ev2:time2, ...]]` | Flex agenda card |
| `[[device: name \| type \| status \| ctrl1:data1, ...]]` | Flex device control card |
| `[[appletv_remote: name \| status]]` | Flex Apple TV remote card |

## User-Sent Inline Directives

Defined in `src/auto-reply/reply/directives.ts`. These `/command` prefixes in user messages change agent behavior for that run.

| Directive | Aliases | Effect |
|---|---|---|
| `/think` | `/thinking`, `/t` | Set thinking/extended-thinking level |
| `/verbose` | `/v` | Set verbose output level |
| `/reasoning` | `/reason` | Set reasoning effort level |
| `/elevated` | `/elev` | Elevate model capabilities |
| `/model` | (+ config aliases) | Override model for this run |
| `/status` | — | Request agent status info |
| `/exec` | — | Control code execution host/security |
| `/queue` | — | Control followup queue mode/debounce/cap |
| `/stop` | — | Abort the current agent run |

## Abort Triggers

Defined in `src/auto-reply/reply/abort.ts`. These exact words (case-insensitive) from the user abort a running agent:

`stop`, `esc`, `abort`, `wait`, `exit`, `interrupt`
