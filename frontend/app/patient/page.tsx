"use client";
// Emmatics patient companion — faithful port of the Lovable prototype
// (seeker-support-bot-site). Layout, flows, and copy mirror the original
// one-screen phone demo with five tabs. Differences from the prototype:
//  - Backend: repo FastAPI via lib/api.ts (search / disease / evidence)
//    instead of the prototype's /api/public/v1 proxy.
//  - Design system: monochrome shadcn tokens. The prototype's hue coding
//    (brand/warm/sage) is re-expressed as weight/fill hierarchy per the
//    repo design refactor: brand→primary, ink→foreground,
//    sage→muted-foreground, warm→foreground-weight accents.
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { api, DiseaseDetail, GraphEdge } from "@/lib/api";
import {
  VoiceButton,
  VoiceProvider,
  useVoiceSession,
  type CheckinDraft,
  type VoiceMsg,
} from "@/components/patient-voice";

// three.js avatar is heavy — load client-side only, when the chat tab mounts.
const AvatarStage = dynamic(() => import("@/components/avatar-stage"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-[10.5px] text-muted-foreground">
      Loading companion…
    </div>
  ),
});

// The prototype pinned MONDO:0020066 (Ehlers-Danlos) for its live research
// feed. Our knowledge-graph content varies by deployment, so the ID is configurable
// and the feed falls back to the first disease the graph returns.
const FEED_DISEASE_ID =
  process.env.NEXT_PUBLIC_PATIENT_DISEASE_ID ?? "MONDO:0020066";

type Tab = "journey" | "home" | "chat" | "community" | "research";

async function searchFirst(q: string) {
  try {
    const r = await api.search(q);
    return r.find((x) => x.type === "Disease") ?? r[0] ?? null;
  } catch {
    return null;
  }
}

async function diseaseDetail(id: string): Promise<DiseaseDetail | null> {
  try {
    return await api.disease(id);
  } catch {
    return null;
  }
}

interface FeedItem {
  title: string;
  rel_type?: string;
  source_db?: string;
}

async function liveFeed(): Promise<FeedItem[]> {
  const fromEdges = (edges: GraphEdge[]) =>
    edges
      .filter((e) => e.description)
      .map((e) => ({
        title: e.description,
        rel_type: e.rel_type,
        source_db: e.source_db,
      }));
  try {
    const edges = await api.evidence(FEED_DISEASE_ID);
    if (edges.length) return fromEdges(edges);
  } catch {
    /* fall through to discovery */
  }
  const hit = await searchFirst("syndrome");
  if (!hit) return [];
  try {
    return fromEdges(await api.evidence(hit.id));
  } catch {
    return [];
  }
}

export default function PatientApp() {
  const [tab, setTab] = useState<Tab>("journey");
  const [toast, setToast] = useState<string | null>(null);
  // Voice check-in: drafted in ChatTab (fill_checkin client tool), consumed
  // once by ResearchTab. Never auto-submitted.
  const [checkinDraft, setCheckinDraft] = useState<CheckinDraft | null>(null);

  // Deep link support: /patient?tab=chat (post-hydration to avoid SSG mismatch)
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (
      t === "journey" ||
      t === "home" ||
      t === "chat" ||
      t === "community" ||
      t === "research"
    )
      setTab(t);
  }, []);

  // Dev/test hook: inject a voice check-in draft without a live ElevenLabs
  // session (window.dispatchEvent(new CustomEvent("emmatics:checkin", {detail}))).
  // Mirrors exactly what the fill_checkin client tool does.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const h = (e: Event) => {
      setCheckinDraft((e as CustomEvent).detail as CheckinDraft);
      setTab("research");
    };
    window.addEventListener("emmatics:checkin", h);
    return () => window.removeEventListener("emmatics:checkin", h);
  }, []);

  useEffect(() => {
    const show = setTimeout(
      () =>
        setToast(
          "✦ Good morning Adira — time for your 08:00 dose. Day 118, keep going!",
        ),
      2500,
    );
    const hide = setTimeout(() => setToast(null), 9000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, []);

  return (
    // Real app shell: dynamic viewport height (dvh handles mobile URL-bar
    // collapse), full-bleed on phones, centered readable column on desktop.
    <div className="relative flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* Ambient blobs (grayscale port of brand/warm/sage washes) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-foreground/10 blur-[80px] blob1" />
        <div className="absolute -right-20 top-1/3 h-72 w-72 rounded-full bg-foreground/[0.07] blur-[80px] blob2" />
        <div className="absolute -bottom-10 left-10 h-64 w-64 rounded-full bg-foreground/[0.05] blur-[80px] blob3" />
      </div>

      <div className="relative z-10 mx-auto flex h-full w-full max-w-xl flex-col pt-[env(safe-area-inset-top)]">
        {/* Header */}
        <header className="glass mx-3 mt-3 flex items-center justify-between rounded-2xl px-3.5 py-2.5 sm:px-5 sm:py-3">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="Emmatics" className="size-7" />
            <span className="font-display text-[15px] font-semibold tracking-tight sm:text-[17px]">
              Emmatics
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="glass-soft flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium text-foreground/70 sm:text-[11px]">
              <span className="size-1.5 rounded-full bg-foreground" />
              Day 118
            </span>
            <span className="grid size-7 place-items-center rounded-full bg-primary/15 font-display text-xs text-primary">
              A
            </span>
          </div>
        </header>

        {/* Daily-support toast */}
        {toast && (
          <button
            onClick={() => setToast(null)}
            className="rise glass absolute left-3 right-3 top-20 z-30 flex items-start gap-2 rounded-2xl p-3 text-left text-[12px] leading-snug"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-foreground/15 text-foreground">
              ✦
            </span>
            <span>
              <span className="block font-semibold">Daily support</span>
              {toast.replace("✦ ", "")}
            </span>
          </button>
        )}

        <main className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3 sm:px-4">
          {tab === "journey" && <JourneyTab onGo={setTab} />}
          {tab === "home" && <OverviewTab onGo={setTab} />}
          {tab === "chat" && (
            <ChatTab onGo={setTab} onDraftCheckin={setCheckinDraft} />
          )}
          {tab === "community" && <CommunityTab />}
          {tab === "research" && (
            <ResearchTab
              draft={checkinDraft}
              onDraftConsumed={() => setCheckinDraft(null)}
            />
          )}
        </main>

        {/* Bottom tab bar (safe-area aware for phones with home indicators) */}
        <nav className="glass mx-3 mb-[max(0.75rem,env(safe-area-inset-bottom))] grid grid-cols-5 rounded-2xl py-2">
          {(
            [
              ["journey", "◎", "Journey"],
              ["home", "⌂", "Overview"],
              ["chat", "", "AI"],
              ["community", "❋", "Community"],
              ["research", "▤", "Research"],
            ] as [Tab, string, string][]
          ).map(([key, icon, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex min-h-11 flex-col items-center justify-center gap-0.5 text-[10px] font-medium sm:text-[11px] ${
                tab === key ? "text-primary" : "text-foreground/45"
              }`}
            >
              {key === "chat" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/logo.svg" alt="" className="size-4" />
              ) : (
                <span className="text-base leading-none">{icon}</span>
              )}
              {label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass rise rounded-3xl p-4 ${className}`}>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- Journey

const JOURNEY_STEPS = [
  {
    t: "Suspected rare disease",
    d: "Your physician noticed an unusual symptom pattern.",
    who: "Physician",
  },
  {
    t: "Registered by physician",
    d: "Dr. Santoso registered you to Emmatics on 04 Mar.",
    who: "Physician",
  },
  {
    t: "Physician visit scheduled",
    d: "Check-up with Dr. Santoso on 12 Oct, 10:30 — reminders 1 day & 1 hour before.",
    who: "Physician + AI",
  },
  {
    t: "You joined the platform",
    d: "Account activated, consent for research sharing given.",
    who: "You",
  },
  {
    t: "AI match & community",
    d: "Connected with 142 patients sharing similar symptoms.",
    who: "AI",
  },
  {
    t: "AI research assistant",
    d: "Ask anything — answers from rare disease researchers' database.",
    who: "AI",
  },
  {
    t: "Periodic check-ins",
    d: "Symptoms, adherence & side effects → sent to researchers.",
    who: "AI → Research",
  },
  {
    t: "Daily motivation",
    d: "Reminders and encouragement to keep your treatment going.",
    who: "AI",
  },
];

function JourneyTab({ onGo }: { onGo: (t: Tab) => void }) {
  return (
    <div className="space-y-3">
      <Panel>
        <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-primary">
          Patient journey · Step 4
        </span>
        <h1 className="mt-3 font-display text-[28px] font-medium leading-[1.05] tracking-tight">
          You are not a symptom list. You are a story.
        </h1>
        <p className="mt-3 text-[13px] leading-relaxed text-foreground/60">
          Emmatics matches your symptoms against a live network of rare-disease
          researchers, physicians, and patients walking the same road — so the
          answer arrives sooner, and you never walk it alone.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={() => onGo("chat")}
            className="rounded-full bg-primary py-2.5 text-[13px] font-semibold text-primary-foreground shadow-lg shadow-primary/30"
          >
            Talk to the AI assistant
          </button>
          <button
            onClick={() => onGo("community")}
            className="glass-soft rounded-full py-2.5 text-[13px] font-semibold text-foreground/80"
          >
            Find my community
          </button>
        </div>
      </Panel>

      <Panel>
        <p className="font-display text-[17px] font-medium">Your journey</p>
        <ol className="mt-3 space-y-0">
          {JOURNEY_STEPS.map((s, i) => {
            const done = i < 3;
            const current = i === 3;
            return (
              <li key={s.t} className="relative flex gap-3 pb-4 last:pb-0">
                {i < JOURNEY_STEPS.length - 1 && (
                  <span
                    className={`absolute left-[11px] top-6 h-full w-px ${
                      done ? "bg-primary" : "bg-foreground/15"
                    }`}
                  />
                )}
                <span
                  className={`relative z-10 grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${
                    done
                      ? "bg-primary text-primary-foreground"
                      : current
                        ? "bg-foreground text-background ring-4 ring-foreground/25"
                        : "glass-soft border border-foreground/15 text-foreground/50"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <div>
                  <p
                    className={`text-[13px] font-semibold ${current ? "underline underline-offset-2" : ""}`}
                  >
                    {s.t}
                  </p>
                  <p className="text-[11.5px] leading-snug text-foreground/55">
                    {s.d}
                  </p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {s.who}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- Overview

/** Symptom cluster graph — nodes sized by prevalence, patient cluster filled. */
function SymptomNetworkArt() {
  const nodes: [number, number, number, boolean][] = [
    [50, 38, 9, true], // fatigue (center)
    [27, 24, 6, true], // hypermobility
    [73, 26, 5, true], // malar rash
    [22, 56, 4.5, false],
    [48, 68, 4, false],
    [76, 58, 5, false],
    [64, 44, 3.5, true],
    [36, 46, 3, false],
  ];
  const edges: [number, number][] = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [0, 5],
    [0, 6],
    [1, 7],
    [2, 6],
    [5, 6],
    [3, 7],
  ];
  return (
    <svg viewBox="0 0 100 75" className="h-full w-full" aria-hidden>
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a][0]}
          y1={nodes[a][1]}
          x2={nodes[b][0]}
          y2={nodes[b][1]}
          className="stroke-foreground/20"
          strokeWidth={nodes[a][3] && nodes[b][3] ? 1.2 : 0.6}
        />
      ))}
      {nodes.map(([x, y, r, hot], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={r}
          className={
            hot ? "fill-foreground/70" : "fill-none stroke-foreground/35"
          }
          strokeWidth={1.2}
        />
      ))}
    </svg>
  );
}

/** Stylised double helix with base-pair rungs. */
function HelixArt() {
  const steps = Array.from({ length: 13 }, (_, i) => i);
  const y = (i: number) => 6 + i * 5.25;
  const xA = (i: number) => 50 + 26 * Math.sin(i * 0.55);
  const xB = (i: number) => 50 + 26 * Math.sin(i * 0.55 + Math.PI);
  const path = (fx: (i: number) => number) =>
    steps.map((i) => `${i === 0 ? "M" : "L"}${fx(i).toFixed(1)},${y(i)}`).join(" ");
  return (
    <svg viewBox="0 0 100 75" className="h-full w-full" aria-hidden>
      {steps.map((i) => (
        <line
          key={i}
          x1={xA(i)}
          y1={y(i)}
          x2={xB(i)}
          y2={y(i)}
          className="stroke-foreground/25"
          strokeWidth={0.8}
        />
      ))}
      <path d={path(xA)} className="fill-none stroke-foreground/60" strokeWidth={2} strokeLinecap="round" />
      <path d={path(xB)} className="fill-none stroke-foreground/40" strokeWidth={2} strokeLinecap="round" />
      {steps
        .filter((i) => i % 3 === 1)
        .map((i) => (
          <circle key={i} cx={xA(i)} cy={y(i)} r={2.4} className="fill-foreground/70" />
        ))}
    </svg>
  );
}

function OverviewTab({ onGo }: { onGo: (t: Tab) => void }) {
  const [taken, setTaken] = useState(false);
  const [reminder, setReminder] = useState(false);
  return (
    <div className="space-y-3">
      <div className="px-1">
        <p className="text-[12px] text-foreground/55">Hello, Adira</p>
        <h1 className="font-display text-[24px] font-medium tracking-tight">
          Today&apos;s overview
        </h1>
      </div>

      <section className="rise flex items-center gap-3 rounded-3xl border border-foreground/20 bg-foreground/5 p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground/15 text-foreground">
          ✦
        </span>
        <p className="text-[12.5px] leading-relaxed text-foreground/70">
          <span className="font-semibold text-foreground">
            Daily support ·{" "}
          </span>
          You&apos;re on day 118 and adherence held at 94%. Your steady
          progress is quietly advancing rare-disease research.
        </p>
      </section>

      <Panel>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Next dose
            </p>
            <p className="font-display text-[22px] font-medium">
              08:00 · Morning
            </p>
          </div>
          <button
            onClick={() => setTaken(true)}
            className={`rounded-full px-4 py-2 text-[12px] font-semibold ${
              taken
                ? "bg-primary/10 text-primary"
                : "bg-primary text-primary-foreground"
            }`}
          >
            {taken ? "✓ Taken" : "Mark taken"}
          </button>
        </div>
      </Panel>

      <Panel>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Next physician visit
            </p>
            <p className="font-display text-[20px] font-medium">
              Dr. Santoso · 12 Oct, 10:30
            </p>
            <p className="mt-0.5 text-[11px] text-foreground/55">
              In 9 days · RS Harapan Kita, Room 204
            </p>
          </div>
          <button
            onClick={() => setReminder(!reminder)}
            className={`rounded-full px-4 py-2 text-[12px] font-semibold ${
              reminder
                ? "bg-primary/10 text-primary"
                : "bg-primary text-primary-foreground"
            }`}
          >
            {reminder ? "✓ Reminder on" : "Remind me"}
          </button>
        </div>
        {reminder && (
          <p className="glass-soft mt-3 rounded-2xl p-3 text-[12px] leading-relaxed text-foreground/70">
            <span className="font-semibold text-primary">
              Reminders set ·{" "}
            </span>
            You&apos;ll be notified 1 day before and 1 hour before your visit.
            Bring your latest check-in summary — it&apos;s already prepared for
            Dr. Santoso.
          </p>
        )}
      </Panel>

      <Panel>
        <div className="flex items-center justify-between">
          <span className="font-display text-[17px] font-medium">
            Symptom match
          </span>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
            87% · 142 peers
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {/* The prototype shipped two photographs (symptom network, genetic
              helix) that are not in the bundle; inline SVG illustrations in
              the monochrome system stand in for them. */}
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-foreground/5">
            <SymptomNetworkArt />
            <span className="absolute bottom-1.5 left-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-foreground/40">
              Symptom network
            </span>
          </div>
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-foreground/5">
            <HelixArt />
            <span className="absolute bottom-1.5 left-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-foreground/40">
              Genetic signature
            </span>
          </div>
        </div>
        <p className="glass-soft mt-3 rounded-2xl p-3 text-[12px] leading-relaxed text-foreground/70">
          &quot;Your cluster of progressive fatigue + joint hypermobility +
          faint malar rash maps most closely to{" "}
          <span className="font-semibold text-primary">
            Ehlers-Danlos spectrum, hypermobile subtype
          </span>
          . 142 patients share this signature.&quot;
        </p>
        <button
          onClick={() => onGo("community")}
          className="mt-3 w-full rounded-full border border-primary/30 bg-primary/10 py-2 text-[12px] font-semibold text-primary"
        >
          View the full match report
        </button>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["Adherence", "94%", "+6% month"],
            ["Symptom data", "12", "shared"],
            ["Researcher", "2", "trials matched"],
          ] as const
        ).map(([label, value, sub]) => (
          <div key={label} className="glass-soft rounded-2xl p-3">
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {label}
            </p>
            <p className="font-display text-[22px] font-medium">{value}</p>
            <p className="text-[10px] text-foreground/50">{sub}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 px-1">
        {["Symptom check", "Treatment adherence", "Side-effect log"].map(
          (label) => (
            <button
              key={label}
              onClick={() => onGo("research")}
              className="glass-soft rounded-full px-3 py-1.5 text-[11px] text-foreground/65"
            >
              {label}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- Chat

const CANNED_REPLIES = [
  {
    k: /pain|joint|sendi|nyeri/i,
    text: "For hypermobile EDS, low-impact strengthening, physiotherapy for joint stability and hydrotherapy show the strongest evidence. Avoid high-impact stretching.",
    src: "Grahame 2019 · EDS Society guidelines",
  },
  {
    k: /tired|fatigue|lelah|capek/i,
    text: "Fatigue in your cluster is often linked to POTS and poor sleep. Pacing activities, hydration (2–3L/day) and salt intake may help — discuss with Dr. Santoso first.",
    src: "Rare Disease Researcher DB · 38 studies",
  },
  {
    k: /side|efek|nausea|mual/i,
    text: "Thanks — I've logged that side effect. It will be included in your next anonymised report to your physician and research team.",
    src: "Logged → Dr. Santoso & research",
  },
  {
    k: /miss|lupa|dose|obat/i,
    text: "That's okay — one missed dose doesn't undo your progress. Take your next dose on schedule; don't double up. I'll send a gentler reminder at 19:30.",
    src: "Treatment protocol · physician-approved",
  },
];

interface ChatMsg {
  from: "ai" | "me";
  text: string;
  src?: string;
}

function ChatTab({
  onGo,
  onDraftCheckin,
}: {
  onGo: (t: Tab) => void;
  onDraftCheckin: (d: CheckinDraft) => void;
}) {
  return (
    <VoiceProvider>
      <ChatTabInner onGo={onGo} onDraftCheckin={onDraftCheckin} />
    </VoiceProvider>
  );
}

function ChatTabInner({
  onGo,
  onDraftCheckin,
}: {
  onGo: (t: Tab) => void;
  onDraftCheckin: (d: CheckinDraft) => void;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([
    {
      from: "ai",
      text: "Hi Adira — I noticed your fatigue score rose this week. Let's check in together.",
    },
    { from: "me", text: "Yes, and I missed two doses of my evening meds." },
    {
      from: "ai",
      text: "Understood. Missing doses can raise fatigue — have you logged any new side effects?",
    },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  // Dev-only avatar preview (window event "emmatics:avatar") — verify the
  // talking head without an ElevenLabs session. detail: {show, speaking}.
  const [avatarPreview, setAvatarPreview] = useState<{
    show: boolean;
    speaking: boolean;
  } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const voice = useVoiceSession({
    onTranscript: (m: VoiceMsg) => setMsgs((prev) => [...prev, m]),
    onSwitchTab: (t) => {
      if (["journey", "home", "chat", "community", "research"].includes(t))
        onGo(t as Tab);
    },
    onFillCheckin: onDraftCheckin,
  });

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail ?? {};
      setAvatarPreview({ show: d.show !== false, speaking: !!d.speaking });
    };
    window.addEventListener("emmatics:avatar", h);
    return () => window.removeEventListener("emmatics:avatar", h);
  }, []);

  useEffect(() => {
    const main = endRef.current?.closest("main");
    if (main) main.scrollTop = main.scrollHeight;
  }, [msgs, typing]);

  const send = (text: string) => {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { from: "me", text }]);
    setInput("");
    setTyping(true);
    (async () => {
      // Live knowledge-graph lookup first (repo backend), canned replies as fallback —
      // same behavior as the prototype.
      const hit = await searchFirst(text);
      if (hit?.id) {
        const detail = await diseaseDetail(hit.id);
        if (detail) {
          const genes = (detail.genes ?? [])
            .map((g) => g.name)
            .filter(Boolean)
            .slice(0, 4)
            .join(", ");
          const phenos = (detail.phenotypes ?? [])
            .map((p) => p.name)
            .filter(Boolean)
            .slice(0, 4)
            .join(", ");
          const nPubs =
            (detail.publications ?? []).length + (detail.studies ?? []).length;
          setMsgs((m) => [
            ...m,
            {
              from: "ai",
              text: `I found "${detail.disease?.name ?? hit.name}" in the Emmatics knowledge graph.${
                genes ? ` Linked genes: ${genes}.` : ""
              }${phenos ? ` Key phenotypes: ${phenos}.` : ""}${
                nPubs
                  ? ` There are ${nPubs} linked publications & studies.`
                  : ""
              } Want me to add this to your check-in for Dr. Santoso?`,
              src: `Emmatics · live · ${hit.id}`,
            },
          ]);
          setTyping(false);
          return;
        }
      }
      setTimeout(() => {
        const canned = CANNED_REPLIES.find((c) => c.k.test(text));
        setMsgs((m) => [
          ...m,
          canned
            ? { from: "ai", text: canned.text, src: canned.src }
            : {
                from: "ai",
                text: "Based on 3,400 physician & researcher records, I'd suggest noting this in your check-in so your care team can review it. Want me to start one?",
                src: "Rare Disease Researcher DB",
              },
        ]);
        setTyping(false);
      }, 900);
    })();
  };

  return (
    <Panel className="flex min-h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border pb-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="Emmatics AI" className="size-9" />
        <div>
          <p className="font-display text-[16px] font-medium leading-none">
            Emmatics AI
          </p>
          <p className="text-[10.5px] text-muted-foreground">
            {voice.active
              ? voice.isSpeaking
                ? "Speaking…"
                : "Listening — just talk"
              : "Trained on 3,400 physician & researcher records"}
          </p>
        </div>
      </div>

      {voice.error && (
        <p className="mt-2 rounded-xl bg-foreground/5 px-3 py-2 text-[10.5px] text-foreground/60">
          Voice unavailable · {voice.error}
        </p>
      )}

      {(voice.active || avatarPreview?.show) && (
        <div className="rise mt-3 overflow-hidden rounded-2xl">
          <div className="glass-soft relative h-56 w-full">
            <AvatarStage
              speaking={voice.isSpeaking || !!avatarPreview?.speaking}
              getFrequencyData={
                voice.active ? voice.getOutputByteFrequencyData : undefined
              }
            />
            <p className="pointer-events-none absolute bottom-2 left-3 text-[9.5px] uppercase tracking-wider text-muted-foreground">
              {voice.isSpeaking ? "Emmatics · speaking" : "Emmatics · listening"}
            </p>
          </div>
        </div>
      )}

      <div className="mt-3 flex-1 space-y-2.5 text-[12.5px]">
        {msgs.map((m, i) =>
          m.from === "ai" ? (
            <div key={i} className="rise flex max-w-[88%] items-start gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.svg" alt="" className="size-7 shrink-0" />
              <div>
                <div className="glass-soft rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-foreground/80">
                  {m.text}
                </div>
                {m.src && (
                  <p className="mt-1 pl-1 text-[9.5px] uppercase tracking-wider text-muted-foreground">
                    Source · {m.src}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div
              key={i}
              className="rise ml-auto max-w-[80%] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2.5 text-primary-foreground"
            >
              {m.text}
            </div>
          ),
        )}
        {typing && (
          <div className="flex items-start gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" className="size-7 shrink-0" />
            <div className="glass-soft w-14 rounded-2xl px-3 py-2 text-foreground/50">
              •••
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto">
        {[
          "New side effect: nausea",
          "Joint pain tips?",
          "I feel tired",
          "I missed a dose",
        ].map((q) => (
          <button
            key={q}
            onClick={() => send(q)}
            className="glass-soft shrink-0 rounded-full px-3 py-1 text-[11px] text-foreground/65"
          >
            {q}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="glass-soft mt-2 flex items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            voice.active
              ? "Voice session active — speak or type…"
              : "Ask about symptoms, adherence, side effects…"
          }
          className="flex-1 bg-transparent text-[12px] outline-none placeholder:text-foreground/40"
        />
        <VoiceButton
          active={voice.active}
          connecting={voice.connecting}
          isSpeaking={voice.isSpeaking}
          onStart={voice.start}
          onStop={voice.stop}
        />
        <button className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground">
          ↑
        </button>
      </form>
    </Panel>
  );
}

// --------------------------------------------------------------- Community

const PEERS = [
  {
    n: "Mira, 29",
    i: "M",
    tag: "hypermobile · 3y on EDS",
    q: "The morning-stiffness protocol Mira shared helped me more than my last prescription change.",
    m: 92,
  },
  {
    n: "Yoga, 41",
    i: "Y",
    tag: "pursued a research trial",
    q: "Emmatics flagged my data to a physician who connected me to an open trial in Jakarta.",
    m: 88,
  },
  {
    n: "Sinta, 35",
    i: "S",
    tag: "POTS + EDS · 5y",
    q: "Salt-loading and pacing changed my afternoons completely.",
    m: 84,
  },
];

const GROUPS: [string, string][] = [
  ["EDS Indonesia", "214 members · weekly live Q&A"],
  ["Connective Tissue Disorders", "1.2k members · category"],
  ["Chronic Fatigue & Rare", "860 members · category"],
];

function CommunityTab() {
  const [connected, setConnected] = useState<string[]>([]);
  const toggle = (name: string) =>
    setConnected((c) =>
      c.includes(name) ? c.filter((x) => x !== name) : [...c, name],
    );
  return (
    <div className="space-y-3">
      <Panel>
        <div className="flex items-center justify-between">
          <span className="font-display text-[17px] font-medium">
            Similar-symptom community
          </span>
          <span className="glass-soft rounded-full px-2.5 py-1 text-[10.5px] text-foreground/60">
            142 in cluster
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          AI-recommended by symptom similarity
        </p>
        <div className="mt-3 space-y-2.5">
          {PEERS.map((peer) => (
            <div key={peer.n} className="glass-soft rounded-2xl p-3">
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-full bg-foreground/15 font-display text-foreground">
                  {peer.i}
                </div>
                <div className="flex-1">
                  <p className="text-[13px] font-semibold">{peer.n}</p>
                  <p className="text-[10.5px] text-muted-foreground">
                    {peer.tag} · {peer.m}% match
                  </p>
                </div>
                <button
                  onClick={() => toggle(peer.n)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                    connected.includes(peer.n)
                      ? "bg-primary/10 text-primary"
                      : "bg-primary text-primary-foreground"
                  }`}
                >
                  {connected.includes(peer.n) ? "✓ Connected" : "Connect"}
                </button>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-foreground/65">
                &quot;{peer.q}&quot;
              </p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <span className="font-display text-[17px] font-medium">
          Rare disease communities
        </span>
        <div className="mt-3 space-y-2">
          {GROUPS.map(([name, sub]) => (
            <div
              key={name}
              className="glass-soft flex items-center justify-between rounded-2xl p-3"
            >
              <div>
                <p className="text-[13px] font-semibold">{name}</p>
                <p className="text-[10.5px] text-foreground/55">{sub}</p>
              </div>
              <button
                onClick={() => toggle(name)}
                className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold text-primary"
              >
                {connected.includes(name) ? "✓ Joined" : "Join"}
              </button>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------- Research & check-ins

const SYMPTOMS = [
  "Fatigue",
  "Joint pain",
  "Dizziness",
  "Rash",
  "Poor sleep",
  "Steady",
];
const SIDE_EFFECTS = ["Nausea", "Headache", "Drowsiness", "None"];

const CONSENT_POINTS: [string, string, string][] = [
  [
    "🔒",
    "Encrypted & private",
    "Data is encrypted end-to-end and stored in a clinically secured environment — never on your phone.",
  ],
  [
    "🙈",
    "Fully anonymised",
    "Your name and identity never leave this app. Researchers only see coded, de-identified data.",
  ],
  [
    "🔬",
    "Research only",
    "Used solely for rare-disease research. Never sold, never shared with insurers or advertisers.",
  ],
  [
    "⏎",
    "Withdraw anytime",
    "One tap in settings stops all sharing, and past data is deleted on request.",
  ],
];

function ResearchTab({
  draft,
  onDraftConsumed,
}: {
  draft: CheckinDraft | null;
  onDraftConsumed: () => void;
}) {
  const [symptoms, setSymptoms] = useState<string[]>(["Fatigue"]);
  const [effects, setEffects] = useState<string[]>([]);
  const [doses, setDoses] = useState(5);
  const [severity, setSeverity] = useState(6);
  const [submitted, setSubmitted] = useState(false);
  const [consent, setConsent] = useState<"ask" | "given" | "declined">("ask");
  const [agreed, setAgreed] = useState(false);
  const [feed, setFeed] = useState<FeedItem[] | null>(null);
  const [voiceFilled, setVoiceFilled] = useState(false);

  // Apply a voice-drafted check-in once. Values land in the normal form
  // state, so the patient reviews and submits exactly as if typed. Known
  // chips are matched case-insensitively; unknown ones are ignored rather
  // than invented.
  useEffect(() => {
    if (!draft) return;
    const match = (options: string[], wanted?: string[]) =>
      wanted
        ?.map((w) =>
          options.find((o) => o.toLowerCase() === w.trim().toLowerCase()),
        )
        .filter((x): x is string => Boolean(x));
    const s = match(SYMPTOMS, draft.symptoms);
    const e = match(SIDE_EFFECTS, draft.effects);
    if (s?.length) setSymptoms(s);
    if (e?.length) setEffects(e);
    if (draft.severity !== undefined) setSeverity(draft.severity);
    if (draft.doses !== undefined) setDoses(draft.doses);
    setSubmitted(false);
    setVoiceFilled(true);
    onDraftConsumed();
  }, [draft, onDraftConsumed]);

  useEffect(() => {
    let alive = true;
    liveFeed().then((items) => {
      if (alive) setFeed(items);
    });
    return () => {
      alive = false;
    };
  }, []);

  const toggleIn = (
    list: string[],
    set: (v: string[]) => void,
    item: string,
  ) =>
    set(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  return (
    <div className="space-y-3">
      {consent === "ask" && (
        <Panel>
          <div className="flex items-center gap-2">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
              🛡
            </span>
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-primary">
              Informed consent
            </span>
          </div>
          <h2 className="mt-3 font-display text-[22px] font-medium leading-tight tracking-tight">
            Before we collect any data — this is your decision.
          </h2>
          <p className="mt-2 text-[12.5px] leading-relaxed text-foreground/65">
            Your weekly check-in can help researchers find answers for rare
            diseases faster. Nothing is collected until you agree, and you stay
            in control.
          </p>
          <ul className="mt-3 space-y-2 text-[12px] leading-relaxed">
            {CONSENT_POINTS.map(([icon, title, body]) => (
              <li key={title} className="glass-soft flex gap-2.5 rounded-2xl p-3">
                <span className="shrink-0">{icon}</span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="text-foreground/60">{body}</span>
                </span>
              </li>
            ))}
          </ul>
          <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-2xl border border-primary/25 bg-primary/5 p-3">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-foreground"
            />
            <span className="text-[12px] leading-relaxed text-foreground/75">
              I have read and understood this. I consent to sharing my
              anonymised check-in data for rare-disease research purposes.
            </span>
          </label>
          <button
            disabled={!agreed}
            onClick={() => setConsent("given")}
            className={`mt-3 w-full rounded-full py-2.5 text-[13px] font-semibold shadow-lg transition ${
              agreed
                ? "bg-primary text-primary-foreground shadow-primary/30"
                : "cursor-not-allowed bg-foreground/10 text-foreground/40 shadow-none"
            }`}
          >
            Agree &amp; continue
          </button>
          <button
            onClick={() => {
              setConsent("declined");
              setAgreed(false);
            }}
            className="mt-2 w-full py-1.5 text-[11.5px] font-semibold text-foreground/45 underline"
          >
            No, not now
          </button>
        </Panel>
      )}

      {consent === "declined" && (
        <Panel>
          <span className="grid size-9 place-items-center rounded-full bg-foreground/10">
            🛡
          </span>
          <h2 className="mt-3 font-display text-[20px] font-medium leading-tight tracking-tight">
            Your data stays yours.
          </h2>
          <p className="mt-2 text-[12.5px] leading-relaxed text-foreground/65">
            No problem — nothing is shared with researchers. You can still use
            the AI assistant, community and reminders. If you change your mind,
            consent is one tap away.
          </p>
          <button
            onClick={() => setConsent("ask")}
            className="mt-3 w-full rounded-full border border-primary/30 bg-primary/10 py-2.5 text-[13px] font-semibold text-primary"
          >
            Review consent again
          </button>
        </Panel>
      )}

      {consent === "given" && (
        <Panel>
          <div className="flex items-center justify-between">
            <span className="font-display text-[17px] font-medium">
              Weekly AI check-in
            </span>
            <span className="rounded-full bg-foreground/10 px-2.5 py-1 text-[10px] font-semibold text-foreground">
              Due today
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between rounded-xl border border-foreground/15 bg-foreground/5 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-foreground/70">
              <span>🛡</span> Consent active · anonymised research sharing
            </p>
            <button
              onClick={() => setConsent("ask")}
              className="text-[10.5px] font-semibold text-primary underline"
            >
              Manage
            </button>
          </div>
          {voiceFilled && !submitted && (
            <p className="rise mt-2 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-[11px] leading-relaxed text-foreground/70">
              <span className="font-semibold text-primary">
                Pre-filled by voice ·{" "}
              </span>
              Emmatics drafted this from your conversation. Review every field,
              then submit yourself.
            </p>
          )}
          {submitted ? (
            <div className="rise mt-4 rounded-2xl bg-primary/10 p-4 text-center">
              <p className="font-display text-[18px] text-primary">
                Thank you, Adira ✓
              </p>
              <p className="mt-1 text-[12px] text-foreground/65">
                Your check-in was anonymised and shared with Dr. Santoso and 2
                research teams.
              </p>
              <button
                onClick={() => setSubmitted(false)}
                className="mt-3 text-[11px] font-semibold text-primary underline"
              >
                Edit check-in
              </button>
            </div>
          ) : (
            <>
              <p className="mt-3 text-[12px] font-semibold">
                How have your symptoms been?
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SYMPTOMS.map((s) => (
                  <button
                    key={s}
                    onClick={() => toggleIn(symptoms, setSymptoms, s)}
                    className={`rounded-full px-3 py-1.5 text-[11px] ${
                      symptoms.includes(s)
                        ? "bg-primary text-primary-foreground"
                        : "glass-soft text-foreground/65"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <CheckinSlider
                label="Symptom severity"
                value={severity}
                max={10}
                onChange={setSeverity}
                suffix="/10"
              />
              <CheckinSlider
                label="Doses taken this week"
                value={doses}
                max={7}
                onChange={setDoses}
                suffix="/7"
              />
              <p className="mt-4 text-[12px] font-semibold">
                Any side effects?
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SIDE_EFFECTS.map((s) => (
                  <button
                    key={s}
                    onClick={() => toggleIn(effects, setEffects, s)}
                    className={`rounded-full px-3 py-1.5 text-[11px] ${
                      effects.includes(s)
                        ? "bg-foreground text-background"
                        : "glass-soft text-foreground/65"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setSubmitted(true)}
                className="mt-4 w-full rounded-full bg-primary py-2.5 text-[13px] font-semibold text-primary-foreground shadow-lg shadow-primary/30"
              >
                Submit &amp; share with research
              </button>
            </>
          )}
        </Panel>
      )}

      <Panel>
        <span className="font-display text-[17px] font-medium">Data flow</span>
        <div className="mt-3 flex items-center justify-between text-center text-[10.5px]">
          {["You", "Emmatics AI", "Physician", "Researcher"].map((who, i) => (
            <div key={who} className="flex items-center gap-1">
              <div>
                {who === "Emmatics AI" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src="/logo.svg" alt="" className="mx-auto size-9" />
                ) : (
                <div className="mx-auto grid size-9 place-items-center rounded-full bg-primary/15 font-display text-primary">
                  {["A", "", "✚", "▤"][i]}
                </div>
                )}
                <p className="mt-1 text-foreground/60">{who}</p>
              </div>
              {i < 3 && <span className="mb-4 text-muted-foreground">→</span>}
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <span className="font-display text-[17px] font-medium">
          Recent shares
        </span>
        <ul className="mt-2 divide-y divide-border text-[12px]">
          {(
            [
              ["Symptom log · week 16", "Dr. Santoso", "2d ago"],
              ["Side effect: headache", "EDS Research Unit, UI", "5d ago"],
              ["Adherence report · March", "Dr. Santoso", "2w ago"],
            ] as const
          ).map(([title, to, when]) => (
            <li key={title} className="flex justify-between py-2">
              <div>
                <p className="font-medium">{title}</p>
                <p className="text-[10.5px] text-muted-foreground">→ {to}</p>
              </div>
              <span className="text-[10.5px] text-foreground/45">{when}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <div className="flex items-center justify-between">
          <span className="font-display text-[17px] font-medium">
            Live research feed
          </span>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold text-primary">
            Emmatics · live
          </span>
        </div>
        <p className="mt-1 text-[11px] text-foreground/55">
          Latest studies on Ehlers-Danlos syndrome from the open research
          network.
        </p>
        <ul className="mt-3 space-y-2">
          {feed === null && (
            <li className="text-[12px] text-foreground/50">
              Loading live studies…
            </li>
          )}
          {feed !== null && feed.length === 0 && (
            <li className="text-[12px] text-foreground/50">
              Live feed is warming up — Emmatics caches new lookups for up to
              7 days.
            </li>
          )}
          {(feed ?? []).slice(0, 4).map((item, i) => (
            <li key={i} className="glass-soft rounded-2xl p-3">
              <p className="text-[12px] font-semibold leading-snug">
                {item.title ?? "Untitled study"}
              </p>
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                {[item.rel_type?.replace(/_/g, " ").toLowerCase(), item.source_db]
                  .filter(Boolean)
                  .join(" · ") || "Research evidence"}
              </p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function CheckinSlider({
  label,
  value,
  max,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
  suffix: string;
}) {
  return (
    <div className="mt-4">
      <div className="flex justify-between text-[11px]">
        <span className="font-semibold">{label}</span>
        <span className="text-primary">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="mt-1.5 w-full accent-foreground"
      />
    </div>
  );
}
