"use client";

// Surf page — drives the full anti-cheat loop client-side:
//   1) GET /api/visit/next     -> pick an eligible campaign
//   2) POST /api/visit/start   -> receive single-use token + redirect URL
//   3) open the short link, run the min-timer countdown
//   4) POST /api/visit/callback with the token -> award credits
// The token never leaves this client except back to our callback, and the
// server independently enforces dwell time — the countdown here is just UX.
import { useCallback, useEffect, useRef, useState } from "react";

type Campaign = {
  id: string;
  title: string | null;
  minTimerSec: number;
  impressionsRemaining: number;
};

type Phase = "idle" | "loading" | "ready" | "counting" | "verifying" | "done" | "empty";

export default function Surf() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState<string>("");
  const [balance, setBalance] = useState<number | null>(null);
  const tokenRef = useRef<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  const loadNext = useCallback(async () => {
    setPhase("loading");
    setMessage("");
    const res = await fetch("/api/visit/next");
    const json = await res.json();
    if (!json.ok) {
      setMessage(`Error: ${json.error}`);
      setPhase("idle");
      return;
    }
    if (!json.data.campaign) {
      setPhase("empty");
      return;
    }
    setCampaign(json.data.campaign);
    setPhase("ready");
  }, []);

  const startVisit = useCallback(async () => {
    if (!campaign) return;
    const res = await fetch("/api/visit/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId: campaign.id }),
    });
    const json = await res.json();
    if (!json.ok) {
      setMessage(`Could not start: ${json.error}`);
      setPhase("ready");
      return;
    }
    tokenRef.current = json.data.token;
    // Open the short link in a new tab for the visitor to view.
    popupRef.current = window.open(json.data.redirectUrl, "_blank", "noopener");
    setSeconds(json.data.minTimerSec);
    setPhase("counting");
  }, [campaign]);

  // Countdown; when it hits 0 we submit the callback.
  useEffect(() => {
    if (phase !== "counting") return;
    if (seconds <= 0) {
      void verify();
      return;
    }
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, seconds]);

  const verify = useCallback(async () => {
    setPhase("verifying");
    const res = await fetch("/api/visit/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenRef.current }),
    });
    const json = await res.json();
    if (!json.ok) {
      setMessage(`Not rewarded: ${json.error}`);
      setPhase("done");
      return;
    }
    setBalance(json.data.balance);
    setMessage(`+${json.data.earned} credit(s) earned!`);
    setPhase("done");
  }, []);

  return (
    <main>
      <h1>Surf</h1>
      {balance !== null && (
        <p className="muted">Balance: <span className="stat">{balance}</span></p>
      )}

      {phase === "idle" && (
        <div className="panel">
          <p>Visit member links and earn credits.</p>
          <button onClick={loadNext}>Get a link</button>
        </div>
      )}

      {phase === "loading" && <div className="panel">Finding a link…</div>}

      {phase === "empty" && (
        <div className="panel">
          <p>No eligible links right now. Check back soon.</p>
          <button onClick={loadNext}>Retry</button>
        </div>
      )}

      {phase === "ready" && campaign && (
        <div className="panel">
          <p><strong>{campaign.title ?? "Member link"}</strong></p>
          <p className="muted">
            Stay for {campaign.minTimerSec}s to earn. {campaign.impressionsRemaining} views left.
          </p>
          <button onClick={startVisit}>Open link &amp; start timer</button>
        </div>
      )}

      {phase === "counting" && (
        <div className="panel">
          <p className="stat">{seconds}s</p>
          <p className="muted">Keep the opened tab in view. Do not close this page.</p>
        </div>
      )}

      {phase === "verifying" && <div className="panel">Verifying visit…</div>}

      {phase === "done" && (
        <div className="panel">
          <p className={message.includes("earned") ? "badge-ok" : "badge-err"}>{message}</p>
          <button onClick={loadNext}>Next link →</button>
        </div>
      )}
    </main>
  );
}
