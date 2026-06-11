import React, { useState, useRef, useEffect, useCallback } from "react";

// ---------- Pokémon palette ----------
const T = {
  red: "#E3350D",      // Pokéball red
  redDark: "#B5270A",
  yellow: "#FFCB05",   // Pokémon yellow
  yellowDark: "#C7A008",
  blue: "#2A75BB",     // Pokémon blue
  navy: "#1B2A4A",
  sky: "#CDE8FF",
  cream: "#FFF9E8",
  white: "#FFFFFF",
  green: "#3CA455",
  line: "#D8DEEA",
  dim: "#5E6B85",
};

const styleTag = `
@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Nunito:wght@400;600;700;800&display=swap');
* { box-sizing: border-box; }
body { margin: 0; }
@keyframes wobble {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-14deg); }
  75% { transform: rotate(14deg); }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@keyframes bounceIn {
  0% { transform: scale(0.9); opacity: 0; }
  60% { transform: scale(1.03); }
  100% { transform: scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
`;

// ---------- CSS Pokéball ----------
function Pokeball({ size = 56, spinning = false }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: size, height: size, borderRadius: "50%", position: "relative",
        background: `linear-gradient(to bottom, ${T.red} 0 46%, ${T.navy} 46% 54%, ${T.white} 54% 100%)`,
        border: `${Math.max(2, size * 0.05)}px solid ${T.navy}`,
        animation: spinning ? "spin 1s linear infinite" : "none",
        flexShrink: 0,
      }}
    >
      <div style={{
        position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        width: size * 0.3, height: size * 0.3, borderRadius: "50%",
        background: T.white, border: `${Math.max(2, size * 0.06)}px solid ${T.navy}`,
        boxShadow: `inset 0 0 0 ${size * 0.04}px ${T.line}`,
      }} />
    </div>
  );
}

// ---------- Voice ----------
function useVoice() {
  const [speaking, setSpeaking] = useState(false);
  const voiceRef = useRef(null);

  useEffect(() => {
    const pick = () => {
      const vs = window.speechSynthesis?.getVoices?.() || [];
      voiceRef.current =
        vs.find((v) => v.lang === "en-GB" && /female|serena|kate|sonia|libby/i.test(v.name)) ||
        vs.find((v) => v.lang === "en-GB") ||
        vs.find((v) => v.lang?.startsWith("en")) ||
        null;
    };
    pick();
    window.speechSynthesis?.addEventListener?.("voiceschanged", pick);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", pick);
  }, []);

  const speak = useCallback((text) => {
    if (!window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voiceRef.current) u.voice = voiceRef.current;
    u.rate = 1.0;
    u.pitch = 1.05;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }, []);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  return { speak, stop, speaking };
}

// ---------- Image helpers ----------
function fileToResizedBase64(file, maxDim = 1100) {
  return new Promise(async (resolve, reject) => {
    const draw = (source, w, h) => {
      const scale = Math.min(1, maxDim / Math.max(w, h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      resolve({ base64: dataUrl.split(",")[1], preview: dataUrl });
    };
    try {
      if (window.createImageBitmap) {
        const bmp = await createImageBitmap(file);
        return draw(bmp, bmp.width, bmp.height);
      }
    } catch {
      // fall through to <img> path below
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { draw(img, img.width, img.height); URL.revokeObjectURL(url); };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image would not load. Try taking the photo again with the camera."));
    };
    img.src = url;
  });
}

function extractJson(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in response");
  return JSON.parse(cleaned.slice(start, end + 1));
}

// ---------- Analysis ----------
async function analyseCard(base64) {
  const prompt = `You are a fun, enthusiastic Pokémon card expert helping a child identify cards. This image may be a photo or a screenshot. It may be blurry, at an angle, partly covered by fingers, photographed off a screen, or in poor light — that is fine. ALWAYS make your best guess. Never refuse and never say you cannot tell.

How to guess when the image is poor:
- Identify the Pokémon from its artwork, colours and silhouette even if the text is unreadable.
- If you can read partial text (name fragments, HP, set symbol), use it.
- If you cannot pin the exact set or card number, guess the most likely one and say it is a best guess.
- Only set identified to false if the image clearly contains no Pokémon card at all.

Estimate the card's rough value in pounds from your own knowledge of the card market. A wide range is absolutely fine — this is for fun, not a valuation.

Respond with ONLY a JSON object, no other text, no markdown fences, in this exact shape:
{
  "identified": true,
  "bestGuess": true or false,
  "cardName": "...",
  "setName": "... or 'Not sure — possibly ...'",
  "cardNumber": "... or ''",
  "rarity": "...",
  "yearOrEra": "...",
  "authenticity": {
    "verdict": "Looks genuine" | "Possibly fake" | "Hard to tell from this photo",
    "confidence": "high" | "medium" | "low",
    "observations": ["short observation 1", "short observation 2"]
  },
  "value": {
    "estimateGBP": "e.g. £1 to £3 — a rough range is fine",
    "basis": "one short sentence",
    "gradedNote": ""
  },
  "power": {
    "hp": "...",
    "attacks": [{"name": "...", "damage": "...", "note": "..."}],
    "competitiveNote": "one fun sentence on how strong this Pokémon is"
  },
  "facts": ["fun fact 1", "fun fact 2"],
  "spokenSummary": "A fun, warm 5 to 7 sentence spoken summary for a child and parent. Cover: which Pokémon it is (say if it is a best guess), whether it looks genuine, roughly what it is worth in pounds, how powerful it is, and one cool fact. UK English, read aloud naturally, say pounds not £, no symbols or bullets. Be playful and encouraging."
}

Authenticity: lean towards "Looks genuine" unless something is clearly wrong (odd fonts, wrong colours, missing accents, strange back). If it is a screenshot of a card image rather than a physical card, say so kindly in the observations and verdict ("Hard to tell from this photo"). A blurry image is NOT a reason to call a card fake.`;

  let response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });
  } catch (e) {
    // The app's API bridge rejected the request (often payload size on mobile)
    throw new Error(`BRIDGE:${e?.message || "request failed"}`);
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const errBody = await response.json();
      detail = errBody?.error?.message || errBody?.message || JSON.stringify(errBody).slice(0, 200);
    } catch {
      try { detail = (await response.text()).slice(0, 200); } catch {}
    }
    throw new Error(`Service error: ${detail}`);
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Service returned an unreadable reply. This usually means you are not signed in to Claude in this browser.");
  }
  if (data?.type === "error" || data?.error) {
    throw new Error(`Service error: ${data?.error?.message || "unknown"}`);
  }
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  try {
    return extractJson(text);
  } catch {
    return {
      identified: true,
      bestGuess: true,
      cardName: "Best guess",
      setName: "",
      cardNumber: "",
      rarity: "",
      yearOrEra: "",
      authenticity: { verdict: "Hard to tell from this photo", confidence: "low", observations: [] },
      value: { estimateGBP: "", basis: "", gradedNote: "" },
      power: { hp: "", attacks: [], competitiveNote: "" },
      facts: [],
      spokenSummary: text ? text.slice(0, 800) : "I had a good look but could not make out that card. Try holding it a little flatter in good light and we will have another go.",
    };
  }
}

// Minimal text-only request to test whether AI calls work at all in this environment
async function testConnection() {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: "Reply with the single word: pong" }],
      }),
    });
    if (!r.ok) return false;
    const d = await r.json();
    return Array.isArray(d?.content);
  } catch {
    return false;
  }
}

// Tries progressively smaller images — mobile app bridges can reject large payloads
async function analyseCardAdaptive(file, setPreview) {
  const sizes = [1000, 640, 420];
  let lastError;
  for (const dim of sizes) {
    try {
      const { base64, preview } = await fileToResizedBase64(file, dim);
      setPreview(preview);
      return await analyseCard(base64);
    } catch (e) {
      lastError = e;
    }
  }
  // Diagnose: can we reach the AI at all from here?
  const textWorks = await testConnection();
  if (textWorks) {
    throw new Error(
      "DIAGNOSIS: This app can reach the AI, but photo scanning is not supported where you are running it. " +
      "Open the published version of this app in Safari (signed in to claude.ai) and it will work there."
    );
  }
  const detail = (lastError?.message || "").replace("BRIDGE:", "");
  throw new Error(
    `DIAGNOSIS: AI calls are not available where you are running this app (${detail}). ` +
    "Fix: publish this artifact, open the link in Safari, sign in to claude.ai there, then add it to your home screen. " +
    "Also check the App Store for a Claude app update."
  );
}

// ---------- UI bits ----------
function Eyebrow({ children, colour }) {
  return (
    <div style={{
      fontFamily: "'Fredoka', sans-serif", fontWeight: 600, fontSize: 12,
      letterSpacing: "0.12em", textTransform: "uppercase",
      color: colour || T.blue, marginBottom: 6,
    }}>{children}</div>
  );
}

function Panel({ children, accent }) {
  return (
    <div style={{
      background: T.white, border: `2px solid ${accent || T.line}`, borderRadius: 16,
      padding: "16px 18px", marginBottom: 12, boxShadow: "0 3px 0 rgba(27,42,74,0.10)",
      animation: "bounceIn 0.35s ease",
    }}>{children}</div>
  );
}

function VerdictBadge({ verdict }) {
  const v = (verdict || "").toLowerCase();
  const colour = v.includes("genuine") ? T.green : v.includes("fake") ? T.red : T.yellowDark;
  return (
    <span style={{
      display: "inline-block", padding: "4px 12px", borderRadius: 999,
      background: T.white, border: `2px solid ${colour}`, color: colour,
      fontWeight: 700, fontSize: 13, fontFamily: "'Fredoka', sans-serif",
    }}>{verdict}</span>
  );
}

function ActionButton({ onClick, children, primary, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1, padding: "14px 12px", borderRadius: 14, cursor: disabled ? "default" : "pointer",
        fontFamily: "'Fredoka', sans-serif", fontWeight: 600, fontSize: 15,
        background: primary ? T.red : T.white,
        color: primary ? T.white : T.navy,
        border: `2px solid ${primary ? T.redDark : T.navy}`,
        boxShadow: `0 3px 0 ${primary ? T.redDark : T.navy}`,
        opacity: disabled ? 0.6 : 1,
      }}
    >{children}</button>
  );
}

// ---------- Main ----------
export default function PokemonCardScanner() {
  const [stage, setStage] = useState("idle"); // idle | scanning | done | error
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const cameraRef = useRef(null);
  const libraryRef = useRef(null);
  const { speak, stop, speaking } = useVoice();

  const handleFile = async (file) => {
    if (!file) return;
    setError("");
    setResult(null);
    setStage("scanning");
    try {
      const r = await analyseCardAdaptive(file, setPreview);
      setResult(r);
      setStage("done");
      if (r.spokenSummary) speak(r.spokenSummary);
    } catch (e) {
      setError(e.message || "Something went wrong reading the card.");
      setStage("error");
      speak("Sorry, I could not read that card. Please try another photo.");
    }
  };

  const reset = () => {
    stop();
    setStage("idle");
    setResult(null);
    setPreview(null);
    setError("");
    if (cameraRef.current) cameraRef.current.value = "";
    if (libraryRef.current) libraryRef.current.value = "";
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: `linear-gradient(180deg, ${T.sky} 0%, #EAF4FF 45%, ${T.cream} 100%)`,
      color: T.navy, fontFamily: "'Nunito', sans-serif", padding: "26px 16px 60px",
    }}>
      <style>{styleTag}</style>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 4 }}>
          <Pokeball size={42} spinning={stage === "scanning"} />
          <div style={{
            fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 34,
            color: T.yellow,
            textShadow: `-2px -2px 0 ${T.blue}, 2px -2px 0 ${T.blue}, -2px 2px 0 ${T.blue}, 2px 2px 0 ${T.blue}, 0 4px 0 ${T.blue}`,
            letterSpacing: "0.02em",
          }}>
            PokéScanner
          </div>
        </div>
        <div style={{ textAlign: "center", color: T.dim, fontSize: 14, fontWeight: 600, marginBottom: 20 }}>
          Snap a card or upload a screenshot — I'll tell you all about it!
        </div>

        {/* Card slot — styled like a blank trading card */}
        {stage !== "done" && (
          <div style={{
            borderRadius: 18, padding: 10, marginBottom: 14,
            background: `linear-gradient(160deg, ${T.yellow}, ${T.yellowDark})`,
            boxShadow: "0 6px 0 rgba(27,42,74,0.18)",
          }}>
            <div style={{
              background: T.white, borderRadius: 12, minHeight: 270,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              border: `2px solid ${T.line}`, padding: 18, position: "relative", overflow: "hidden",
            }}>
              {preview ? (
                <img src={preview} alt="Your card" style={{ maxHeight: 230, maxWidth: "100%", borderRadius: 8 }} />
              ) : (
                <>
                  <div style={{ animation: "wobble 2.4s ease-in-out infinite" }}>
                    <Pokeball size={72} />
                  </div>
                  <div style={{
                    fontFamily: "'Fredoka', sans-serif", fontWeight: 600, fontSize: 18, marginTop: 14, color: T.navy,
                  }}>
                    Your card goes here!
                  </div>
                  <div style={{ color: T.dim, fontSize: 13, fontWeight: 600, marginTop: 4, textAlign: "center" }}>
                    Flat, good light, fill the frame
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Capture buttons */}
        {stage !== "done" && (
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <ActionButton primary disabled={stage === "scanning"} onClick={() => cameraRef.current?.click()}>
              📷 Take a photo
            </ActionButton>
            <ActionButton disabled={stage === "scanning"} onClick={() => libraryRef.current?.click()}>
              🖼️ Upload a screenshot
            </ActionButton>
          </div>
        )}

        <input
          ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <input
          ref={libraryRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        {stage === "scanning" && (
          <div style={{
            textAlign: "center", color: T.blue, fontWeight: 700, fontSize: 15,
            fontFamily: "'Fredoka', sans-serif",
          }}>
            Searching the Pokédex…
          </div>
        )}

        {stage === "error" && (
          <Panel accent={T.red}>
            <div style={{ color: T.red, fontWeight: 800, marginBottom: 6 }}>Oops — could not read the card</div>
            <div style={{ fontSize: 13, color: T.dim, fontWeight: 600, wordBreak: "break-word" }}>{error}</div>
            <div style={{ marginTop: 12, display: "flex" }}>
              <ActionButton primary onClick={reset}>Try again</ActionButton>
            </div>
          </Panel>
        )}

        {/* Results */}
        {stage === "done" && result && (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <ActionButton primary onClick={() => (speaking ? stop() : speak(result.spokenSummary))}>
                {speaking ? "■ Stop" : "▶ Hear it again"}
              </ActionButton>
              <ActionButton onClick={reset}>Scan another</ActionButton>
            </div>

            {!result.identified ? (
              <Panel accent={T.yellowDark}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Hmm, that doesn't look like a Pokémon card</div>
                <div style={{ fontSize: 14, color: T.dim, fontWeight: 600 }}>{result.spokenSummary}</div>
              </Panel>
            ) : (
              <>
                <Panel accent={T.blue}>
                  <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                    {preview && (
                      <img src={preview} alt="Your card" style={{
                        width: 100, borderRadius: 8, border: `2px solid ${T.line}`, flexShrink: 0,
                      }} />
                    )}
                    <div>
                      <div style={{
                        fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 22,
                        lineHeight: 1.15, color: T.navy,
                      }}>
                        {result.cardName}
                        {result.bestGuess && (
                          <span style={{
                            marginLeft: 8, fontSize: 11, fontWeight: 600, color: T.white,
                            background: T.blue, borderRadius: 999, padding: "3px 9px",
                            verticalAlign: "middle", letterSpacing: "0.06em",
                          }}>BEST GUESS</span>
                        )}
                      </div>
                      <div style={{ color: T.dim, fontSize: 13, fontWeight: 600, marginTop: 4 }}>
                        {[result.setName, result.cardNumber, result.rarity, result.yearOrEra].filter(Boolean).join(" · ")}
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <VerdictBadge verdict={result.authenticity?.verdict} />
                      </div>
                    </div>
                  </div>
                </Panel>

                <Panel>
                  <Eyebrow>Real or fake? · {result.authenticity?.confidence} confidence</Eyebrow>
                  {(result.authenticity?.observations || []).map((o, i) => (
                    <div key={i} style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>• {o}</div>
                  ))}
                  <div style={{ fontSize: 12, color: T.dim, fontWeight: 600, marginTop: 8 }}>
                    A photo check is just for fun. Valuable cards deserve professional grading.
                  </div>
                </Panel>

                <Panel accent={T.yellow}>
                  <Eyebrow colour={T.yellowDark}>Treasure value</Eyebrow>
                  <div style={{
                    fontFamily: "'Fredoka', sans-serif", fontWeight: 700, fontSize: 26, color: T.yellowDark,
                  }}>{result.value?.estimateGBP || "—"}</div>
                  {result.value?.basis && (
                    <div style={{ fontSize: 13, color: T.dim, fontWeight: 600, marginTop: 4 }}>{result.value.basis}</div>
                  )}
                </Panel>

                <Panel accent={T.red}>
                  <Eyebrow colour={T.red}>Battle power</Eyebrow>
                  {result.power?.hp && (
                    <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>❤️ HP {result.power.hp}</div>
                  )}
                  {(result.power?.attacks || []).map((a, i) => (
                    <div key={i} style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                      ⚡ <strong>{a.name}</strong>{a.damage ? ` — ${a.damage}` : ""}{a.note ? ` · ${a.note}` : ""}
                    </div>
                  ))}
                  {result.power?.competitiveNote && (
                    <div style={{ fontSize: 13, color: T.dim, fontWeight: 600, marginTop: 6 }}>
                      {result.power.competitiveNote}
                    </div>
                  )}
                </Panel>

                {(result.facts || []).length > 0 && (
                  <Panel accent={T.green}>
                    <Eyebrow colour={T.green}>Did you know?</Eyebrow>
                    {result.facts.map((f, i) => (
                      <div key={i} style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>★ {f}</div>
                    ))}
                  </Panel>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
