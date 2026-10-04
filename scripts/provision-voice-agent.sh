#!/usr/bin/env bash
# One-shot provisioning of the Rarepath voice agent on ElevenLabs.
# Creates workspace tools (atlas_brief webhook + switch_tab client), creates
# the agent referencing them, enables auth, sets Fly secrets, verifies prod.
#
# Usage:  ELEVENLABS_API_KEY=sk_... ./scripts/provision-voice-agent.sh
# Re-running creates new resources; delete old ones in the dashboard if you
# re-provision.
set -euo pipefail

: "${ELEVENLABS_API_KEY:?set ELEVENLABS_API_KEY=sk_...}"
API_BASE="${ATLAS_API_BASE:-https://rare-disease-atlas-api.fly.dev}"
EL="https://api.elevenlabs.io"

el() { # el METHOD PATH JSON_BODY
  curl -sf -X "$1" "$EL$2" \
    -H "xi-api-key: $ELEVENLABS_API_KEY" \
    -H "Content-Type: application/json" \
    ${3:+-d "$3"}
}
jqpy() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "1/5 Creating atlas_brief webhook tool…"
WEBHOOK_TOOL=$(python3 - "$API_BASE" <<'PY'
import json, sys
print(json.dumps({"tool_config": {
  "type": "webhook",
  "name": "atlas_brief",
  "description": ("Look up a disease, symptom cluster, or research topic in "
                  "the Emmatics. Returns a spoken brief plus "
                  "patient-vetted evidence that passed the patient trust gate. "
                  "Call this for every disease or research question."),
  "api_schema": {
    "url": f"{sys.argv[1]}/v1/voice/tools/atlas-brief",
    "method": "GET",
    "query_params_schema": {
      "properties": {
        "q": {"type": "string",
              "description": "disease name or topic to look up"}
      },
      "required": ["q"]
    }
  },
  "response_timeout_secs": 15
}}))
PY
)
ATLAS_TOOL_ID=$(el POST /v1/convai/tools "$WEBHOOK_TOOL" | jqpy "['id']")
echo "   atlas_brief: $ATLAS_TOOL_ID"

say "2/5 Creating switch_tab client tool…"
CLIENT_TOOL=$(python3 <<'PY'
import json
print(json.dumps({"tool_config": {
  "type": "client",
  "name": "switch_tab",
  "description": ("Switch the patient app to a tab when the patient asks to "
                  "see something. Tabs: journey, home, chat, community, "
                  "research."),
  "expects_response": False,
  "parameters": {
    "type": "object",
    "properties": {
      "tab": {"type": "string",
              "description": "one of: journey, home, chat, community, research"}
    },
    "required": ["tab"]
  }
}}))
PY
)
SWITCH_TOOL_ID=$(el POST /v1/convai/tools "$CLIENT_TOOL" | jqpy "['id']")
echo "   switch_tab: $SWITCH_TOOL_ID"

say "2b/5 Creating fill_checkin client tool…"
CHECKIN_TOOL=$(python3 <<'PY'
import json
print(json.dumps({"tool_config": {
  "type": "client",
  "name": "fill_checkin",
  "description": ("Pre-fill the patient's weekly check-in form from what they "
                  "told you. Only call after the patient described symptoms, "
                  "side effects, or adherence. The patient reviews and "
                  "submits the form themselves; this never submits."),
  "expects_response": True,
  "parameters": {
    "type": "object",
    "properties": {
      "symptoms": {"type": "array",
        "items": {"type": "string", "description": "one symptom name"},
        "description": "subset of: Fatigue, Joint pain, Dizziness, Rash, Poor sleep, Steady"},
      "side_effects": {"type": "array",
        "items": {"type": "string", "description": "one side effect name"},
        "description": "subset of: Nausea, Headache, Drowsiness, None"},
      "severity": {"type": "number",
        "description": "overall symptom severity 0-10"},
      "doses_taken": {"type": "number",
        "description": "doses taken this week, 0-7"}
    },
    "required": []
  }
}}))
PY
)
CHECKIN_TOOL_ID=$(el POST /v1/convai/tools "$CHECKIN_TOOL" | jqpy "['id']")
echo "   fill_checkin: $CHECKIN_TOOL_ID"

say "3/5 Creating agent…"
AGENT=$(python3 - "$ATLAS_TOOL_ID" "$SWITCH_TOOL_ID" "$CHECKIN_TOOL_ID" <<'PY'
import json, sys
prompt = """You are Rarepath, a warm voice companion for rare-disease patients. You are speaking with Adira, who is on day 118 of treatment under Dr. Santoso.

Rules:
- You are NOT a diagnostician. Never diagnose, never adjust medication. Symptoms get logged and routed to Dr. Santoso.
- For any disease or research question, call the emmatics_brief tool and speak only from its spoken_brief and facts. If facts are empty, say the evidence has not yet passed the patient-safety review and keep it general.
- Always name your source briefly ("according to the Emmatics").
- Missed doses: reassure, never advise doubling up, offer a reminder.
- Keep replies under three sentences unless asked for detail. Speak plainly, no jargon unless the patient uses it first.
- Use the switch_tab client tool when the patient wants to see something: journey, home, chat, community, research.
- When the patient describes symptoms, side effects, or missed/taken doses, offer to draft their weekly check-in. If they agree, call fill_checkin with what they told you, then tell them to review the form and submit it themselves. Never claim you submitted it.
- Adira lives in Jakarta. If she speaks Bahasa Indonesia, switch to Bahasa Indonesia and stay warm and informal ("kamu", not "Anda").
- If the patient sounds distressed or describes an emergency, tell them to contact their physician or emergency services immediately."""
print(json.dumps({
  "name": "Rarepath patient companion",
  "conversation_config": {
    "agent": {
      "first_message": "Hi Adira, it's Rarepath. How are you feeling today?",
      "language": "en",
      "prompt": {
        "prompt": prompt,
        "tool_ids": [sys.argv[1], sys.argv[2], sys.argv[3]],
        "built_in_tools": {
          "language_detection": {
            "type": "system",
            "name": "language_detection",
            "description": "",
            "params": {"system_tool_type": "language_detection"}
          }
        }
      }
    },
    "language_presets": {
      "id": {
        "overrides": {
          "agent": {
            "first_message": "Halo Adira, ini Rarepath. Bagaimana perasaanmu hari ini?"
          }
        }
      }
    }
  },
  "platform_settings": {
    "auth": {"enable_auth": True}
  }
}))
PY
)
AGENT_ID=$(el POST /v1/convai/agents/create "$AGENT" | jqpy "['agent_id']")
echo "   agent_id: $AGENT_ID"

say "4/5 Setting Fly secrets (triggers redeploy)…"
fly secrets set "ELEVENLABS_API_KEY=$ELEVENLABS_API_KEY" "ELEVENLABS_AGENT_ID=$AGENT_ID"

say "5/5 Waiting for API, then verifying signed-url end to end…"
CONF=""
for _ in $(seq 1 30); do
  CONF=$(curl -sf -m 5 "$API_BASE/v1/voice/status" 2>/dev/null \
    | jqpy "['configured']" 2>/dev/null || echo "")
  [ "$CONF" = "True" ] && break
  sleep 4
done
[ "$CONF" = "True" ] || { echo "API never reported configured:true"; exit 1; }

curl -sf "$API_BASE/v1/voice/signed-url" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['signed_url'].startswith('wss'), d; print('   signed_url OK:', d['signed_url'][:60] + '…')"

say "Done. Open /patient?tab=chat and press the mic."
echo "Agent dashboard: https://elevenlabs.io/app/agents/$AGENT_ID"
