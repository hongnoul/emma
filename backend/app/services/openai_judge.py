"""OpenAI logprobs judge: answers the same question packs as Laya.

Design: each question in a pack becomes one Chat Completions call with a
single-token constrained answer and ``logprobs`` enabled. The token-level
``top_logprobs`` distribution is renormalized over the valid answer tokens,
giving a probability distribution per question -- the same contract Laya's
``Router.predict`` returns:

    {"answers": {
        "edge_valid":     {"noul": p_yes},
        "rel_class":      {"probabilities": {criterion_key: p, ...}},
        "evidence_level": {"score": expected, "probabilities": {"0": p, ...}},
        "contradicted":   {"noul": p_yes},
    }}

Spend cap: every response's usage is priced and accumulated; once the total
crosses ``EMMATICS_OPENAI_BUDGET_USD`` (default $5), further calls raise
``BudgetExceeded`` instead of silently spending more.

Env:
    OPENAI_API_KEY            required (falls back to ~/.codex/auth.json)
    EMMATICS_OPENAI_MODEL       default gpt-4o-mini (must expose logprobs;
                              reasoning models like o-series do not)
    EMMATICS_OPENAI_BUDGET_USD  default 5.0

Zero non-stdlib dependencies: uses urllib so the backend needs no new package.
"""
from __future__ import annotations

import json
import math
import os
import threading
import urllib.error
import urllib.request
from pathlib import Path

API_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_MODEL = "gpt-4o-mini"

# USD per 1M tokens (input, output). Used for the spend cap estimate.
PRICES = {
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1": (2.00, 8.00),
    "gpt-4o": (2.50, 10.00),
}
_FALLBACK_PRICE = (2.50, 10.00)  # assume something expensive if unknown


class BudgetExceeded(RuntimeError):
    pass


class _Spend:
    """Process-wide estimated spend tracker (thread-safe)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.usd = 0.0
        self.calls = 0

    def add(self, model: str, usage: dict):
        base = next((p for m, p in PRICES.items() if model.startswith(m)), _FALLBACK_PRICE)
        cost = (usage.get("prompt_tokens", 0) * base[0]
                + usage.get("completion_tokens", 0) * base[1]) / 1e6
        with self.lock:
            self.usd += cost
            self.calls += 1

    def check(self, budget: float):
        with self.lock:
            if self.usd >= budget:
                raise BudgetExceeded(
                    f"OpenAI judge spend cap hit: ${self.usd:.4f} >= ${budget:.2f} "
                    f"after {self.calls} calls (raise EMMATICS_OPENAI_BUDGET_USD to continue)")


SPEND = _Spend()


def resolve_api_key() -> str:
    key = os.environ.get("OPENAI_API_KEY")
    if key:
        return key
    codex = Path.home() / ".codex" / "auth.json"
    if codex.exists():
        try:
            key = json.loads(codex.read_text()).get("OPENAI_API_KEY")
            if key:
                return key
        except Exception:
            pass
    raise RuntimeError("OPENAI_API_KEY is not set (and no ~/.codex/auth.json fallback)")


# Answer-token aliases accepted when renormalizing the top_logprobs mass.
_YES = {"yes", "true", "y"}
_NO = {"no", "false", "n"}


class OpenAIJudge:
    def __init__(self, model: str | None = None, budget_usd: float | None = None):
        self.model = model or os.environ.get("EMMATICS_OPENAI_MODEL", os.environ.get("ATLAS_OPENAI_MODEL", DEFAULT_MODEL))
        self.budget = budget_usd if budget_usd is not None else float(
            os.environ.get("EMMATICS_OPENAI_BUDGET_USD", os.environ.get("ATLAS_OPENAI_BUDGET_USD", "5.0")))
        self._key = resolve_api_key()

    # ------------------------------------------------------------- transport

    def _complete(self, prompt: str) -> list[dict]:
        """One single-token completion; returns top_logprobs of token 1."""
        SPEND.check(self.budget)
        body = json.dumps({
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 1,
            "temperature": 0,
            "logprobs": True,
            "top_logprobs": 20,
        }).encode()
        req = urllib.request.Request(API_URL, data=body, headers={
            "Authorization": f"Bearer {self._key}",
            "Content-Type": "application/json",
        })
        last_err: Exception | None = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    data = json.loads(resp.read())
                SPEND.add(self.model, data.get("usage", {}))
                content = data["choices"][0]["logprobs"]["content"]
                return content[0]["top_logprobs"] if content else []
            except urllib.error.HTTPError as e:  # 429/5xx: brief backoff
                last_err = e
                if e.code in (429, 500, 502, 503) and attempt < 2:
                    import time
                    time.sleep(1.5 * (attempt + 1))
                    continue
                raise
        raise last_err  # pragma: no cover

    # ------------------------------------------------------------ questions

    @staticmethod
    def _mass(top: list[dict], buckets: dict[str, set[str]]) -> dict[str, float]:
        """Renormalize top_logprobs mass over named buckets of alias tokens."""
        raw = {k: 0.0 for k in buckets}
        for t in top:
            tok = t["token"].strip().lower()
            for name, aliases in buckets.items():
                if tok in aliases:
                    raw[name] += math.exp(t["logprob"])
        total = sum(raw.values())
        if total <= 0:  # model answered outside the expected set
            n = len(raw)
            return {k: 1.0 / n for k in raw}
        return {k: v / total for k, v in raw.items()}

    def _noul(self, state: str, instructions: str) -> float:
        prompt = (f"{instructions}\n\n{state}\n\n"
                  "Answer with exactly one word: Yes or No.")
        probs = self._mass(self._complete(prompt), {"yes": _YES, "no": _NO})
        return probs["yes"]

    def _choice(self, state: str, instructions: str, criteria: dict) -> dict[str, float]:
        keys = list(criteria)
        listing = "\n".join(f"{i + 1}. {k}: {criteria[k]}" for i, k in enumerate(keys))
        prompt = (f"{instructions}\n\nOptions:\n{listing}\n\n{state}\n\n"
                  f"Answer with only the option number (1-{len(keys)}).")
        buckets = {k: {str(i + 1)} for i, k in enumerate(keys)}
        return self._mass(self._complete(prompt), buckets)

    def _score(self, state: str, instructions: str, criteria: list) -> tuple[float, dict[str, float]]:
        listing = "\n".join(f"{i + 1}. {c}" for i, c in enumerate(criteria))
        prompt = (f"{instructions}\n\nLevels (weakest to strongest):\n{listing}\n\n{state}\n\n"
                  f"Answer with only the level number (1-{len(criteria)}).")
        buckets = {str(i): {str(i + 1)} for i in range(len(criteria))}
        probs = self._mass(self._complete(prompt), buckets)
        expected = sum(int(k) * v for k, v in probs.items())
        return expected, probs

    # ---------------------------------------------------------------- public

    def predict(self, state: str, questions: dict) -> dict:
        """Laya-Router-compatible: answers every question in the pack."""
        answers = {}
        for qid, q in questions.items():
            qtype, instr = q["type"], q["instructions"]
            if qtype == "noul":
                answers[qid] = {"noul": self._noul(state, instr)}
            elif qtype == "choice":
                answers[qid] = {"probabilities": self._choice(state, instr, q["criteria"])}
            elif qtype == "score":
                score, probs = self._score(state, instr, q["criteria"])
                answers[qid] = {"score": score, "probabilities": probs}
            else:
                raise ValueError(f"unknown question type: {qtype}")
        return {"answers": answers}

    @property
    def spend_usd(self) -> float:
        return SPEND.usd
