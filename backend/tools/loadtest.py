"""Load test: N concurrent requests mixing GET /api/shelters, POST /api/sos and GET /api/route.

    python tools/loadtest.py [--base-url http://localhost:8000] [--requests 200] [--mix 60,10,30] [--no-sos]

Reports p50/p95/max latency per endpoint and overall, plus status-code counts. A 429 is the server's rate limiter
working as designed (POST /api/sos is capped at 10/min per IP, everything at RATE_LIMIT_GLOBAL/min) so it is counted
separately from real errors (5xx, timeouts, connection failures). Needs: pip install httpx (already in requirements).
Note: POST /api/sos writes real SOS rows to the server's database (use sim "Reset" afterwards, or --no-sos).
"""
import argparse
import asyncio
import random
import statistics
import time
import uuid
from collections import Counter

import httpx

BAKU = (40.33, 40.45, 49.75, 49.95)  # lat/lng box; SOS are scattered so they do not form a cluster alert


def pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    v = sorted(values)
    return v[min(len(v) - 1, max(0, round(p / 100 * len(v)) - 1))]


async def one(client: httpx.AsyncClient, kind: str, results: list, gate: asyncio.Event):
    lat, lng = random.uniform(BAKU[0], BAKU[1]), random.uniform(BAKU[2], BAKU[3])
    await gate.wait()  # release every task at once => truly concurrent
    t0 = time.perf_counter()
    try:
        if kind == "GET shelters":
            r = await client.get("/api/shelters")
        elif kind == "POST sos":
            r = await client.post("/api/sos", json={"citizenId": str(uuid.uuid4()), "type": random.choice(
                ["fire", "collapse", "flood", "medical"]), "lat": lat, "lng": lng, "note": "loadtest"})
        else:
            r = await client.get("/api/route", params={"fromLat": lat, "fromLng": lng})
        status = r.status_code
    except Exception as e:  # timeout / connection reset / ...
        status = type(e).__name__
    results.append((kind, status, (time.perf_counter() - t0) * 1000))


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--requests", type=int, default=200)
    ap.add_argument("--mix", default="60,10,30", help="percent GET shelters, POST sos, GET route")
    ap.add_argument("--no-sos", action="store_true", help="replace POST sos by GET shelters (no DB writes)")
    ap.add_argument("--timeout", type=float, default=15.0)
    a = ap.parse_args()

    w = [int(x) for x in a.mix.split(",")]
    kinds = ["GET shelters", "POST sos", "GET route"]
    if a.no_sos:
        w[0], w[1] = w[0] + w[1], 0
    plan = random.choices(kinds, weights=w, k=a.requests)

    limits = httpx.Limits(max_connections=a.requests, max_keepalive_connections=a.requests)
    results: list = []
    async with httpx.AsyncClient(base_url=a.base_url, timeout=a.timeout, limits=limits) as client:
        gate = asyncio.Event()
        tasks = [asyncio.create_task(one(client, k, results, gate)) for k in plan]
        await asyncio.sleep(0.2)
        t0 = time.perf_counter()
        gate.set()
        await asyncio.gather(*tasks)
        wall = time.perf_counter() - t0

    print(f"\n{a.requests} concurrent requests -> {a.base_url}   wall time {wall:.2f}s   ({a.requests / wall:.0f} req/s)\n")
    print(f"{'endpoint':<14}{'n':>5}{'p50 ms':>9}{'p95 ms':>9}{'max ms':>9}   status codes")
    for k in kinds + ["ALL"]:
        rows = [r for r in results if k == "ALL" or r[0] == k]
        if not rows:
            continue
        ms = [r[2] for r in rows]
        codes = dict(Counter(str(r[1]) for r in rows))
        print(f"{k:<14}{len(rows):>5}{statistics.median(ms):>9.0f}{pct(ms, 95):>9.0f}{max(ms):>9.0f}   {codes}")

    ok = sum(1 for _, s, _ in results if s in (200, 201))
    limited = sum(1 for _, s, _ in results if s == 429)
    errors = [(k, s) for k, s, _ in results if s not in (200, 201, 429)]
    print(f"\nsuccess {ok}   rate-limited (429, expected) {limited}   errors {len(errors)}", end="")
    print(f"  {dict(Counter(f'{k}:{s}' for k, s in errors))}" if errors else "")
    raise SystemExit(1 if errors else 0)


if __name__ == "__main__":
    asyncio.run(main())
