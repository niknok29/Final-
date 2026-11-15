"""Load test for the Crisis Evac Engine backend.

  Scenario "mix" (default): N concurrent requests mixing GET /api/shelters, POST /api/sos and GET /api/route.
      python tools/loadtest.py --base-url http://127.0.0.1:8000 [--requests 200] [--mix 60,10,30] [--no-sos]

  Scenario "flood": an SOS spam attack. 600 POST /api/sos with 600 different random citizenIds (some repeated
  citizen+type pairs = duplicates, some from the same coordinates) plus 200 GET shelters/route, all released at once
  from ONE IP, while a dispatcher dashboard poll (GET /api/dashboard with a token, every 200 ms) measures whether the
  dispatcher UI stays responsive DURING the flood.
      python tools/loadtest.py --scenario flood --base-url http://127.0.0.1:8000

Reports avg/p50/p95/p99/max latency overall, per endpoint and for accepted vs rejected requests, plus status
counts. A 429 is a limiter working as designed (counted separately from real errors: 5xx, timeouts, resets).
No third-party packages: a lean raw-asyncio HTTP/1.1 client is used on purpose (httpx costs ~2-3 ms of client CPU per
request, which would be measured as server latency at 800 concurrent requests). Use 127.0.0.1, not localhost, on Windows (IPv6 fallback adds ~200 ms per
connection). POST /api/sos writes real rows to the server's database: use a throw-away DB (DATABASE_URL) or the sim
"Reset" afterwards. From one IP the per-IP limit (10/min) rejects most SOS cheaply; start the server with
RATE_LIMIT_SOS=100000 RATE_LIMIT_GLOBAL=100000 to simulate a distributed attack that reaches the real pipeline.
Exit code 1 on any error / 5xx, or (flood) when avg latency >= --target-avg-ms or the dashboard is too slow.
"""
import argparse
import asyncio
import json
import multiprocessing
import random
import statistics
import time
import uuid
from collections import Counter
from urllib.parse import urlencode, urlparse

BAKU = (40.33, 40.45, 49.75, 49.95)  # lat/lng box
TYPES = ["fire", "collapse", "flood", "medical"]


def pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    v = sorted(values)
    return v[min(len(v) - 1, max(0, round(p / 100 * len(v)) - 1))]


def stats_line(label: str, ms: list[float], extra: str = "") -> str:
    if not ms:
        return f"{label:<22}{0:>5}"
    return (f"{label:<22}{len(ms):>5}{statistics.fmean(ms):>9.0f}{statistics.median(ms):>9.0f}{pct(ms, 95):>9.0f}"
            f"{pct(ms, 99):>9.0f}{max(ms):>9.0f}   {extra}")


HEADER = f"{'':<22}{'n':>5}{'avg ms':>9}{'p50 ms':>9}{'p95 ms':>9}{'p99 ms':>9}{'max ms':>9}   status"


def classify(kind: str, status, dup: bool) -> str:
    if kind == "POST sos":
        if status == 201:
            return "201 created"
        if status == 200 and dup:
            return "200 duplicate"
    return str(status)


class Server:
    """Target host/port. Every request opens its own connection (like 800 separate clients would)."""

    def __init__(self, base_url: str, timeout: float):
        u = urlparse(base_url)
        self.host, self.port, self.timeout = u.hostname, u.port or 80, timeout

    async def request(self, method: str, path: str, body: dict | None = None, params: dict | None = None,
                      headers: dict | None = None) -> tuple[int, bytes]:
        if params:
            path += "?" + urlencode(params)
        payload = json.dumps(body).encode() if body is not None else b""
        head = (f"{method} {path} HTTP/1.1\r\nHost: {self.host}:{self.port}\r\nConnection: close\r\n"
                "Accept: application/json\r\n")
        if body is not None:
            head += f"Content-Type: application/json\r\nContent-Length: {len(payload)}\r\n"
        head += "".join(f"{k}: {v}\r\n" for k, v in (headers or {}).items())
        reader, writer = await asyncio.wait_for(asyncio.open_connection(self.host, self.port), self.timeout)
        try:
            writer.write(head.encode() + b"\r\n" + payload)
            data = await asyncio.wait_for(reader.read(-1), self.timeout)
        finally:
            writer.close()
        status = int(data.split(b" ", 2)[1])
        return status, (data.split(b"\r\n\r\n", 1) + [b""])[1]


async def one(srv: Server, kind: str, body: dict | None, params: dict | None, results: list, gate: asyncio.Event):
    await gate.wait()  # release every task at once => truly concurrent
    t0 = time.perf_counter()
    dup = False
    try:
        if kind == "GET shelters":
            status, _ = await srv.request("GET", "/api/shelters")
        elif kind == "POST sos":
            status, raw = await srv.request("POST", "/api/sos", body=body)
            if status == 200:
                dup = bool(json.loads(raw).get("duplicate"))
        else:
            status, _ = await srv.request("GET", "/api/route", params=params)
    except Exception as e:  # timeout / connection reset / ...
        status = type(e).__name__
    results.append((kind, classify(kind, status, dup), (time.perf_counter() - t0) * 1000))


def report(results: list, wall: float, n: int, kinds: list[str]) -> list:
    print(f"\n{n} concurrent requests, wall time {wall:.2f}s ({n / wall:.0f} req/s)\n")
    print(HEADER)
    for k in kinds:
        rows = [r for r in results if r[0] == k]
        if rows:
            print(stats_line(k, [r[2] for r in rows], str(dict(Counter(r[1] for r in rows)))))
    ok = lambda s: s in ("200", "201", "201 created", "200 duplicate")  # noqa: E731
    print(stats_line("ALL", [r[2] for r in results], str(dict(Counter(r[1] for r in results)))))
    print(stats_line("accepted (2xx)", [r[2] for r in results if ok(r[1])]))
    print(stats_line("rejected (429)", [r[2] for r in results if r[1] == "429"]))
    return [r for r in results if not ok(r[1]) and r[1] != "429"]


async def mix(a):
    w = [int(x) for x in a.mix.split(",")]
    kinds = ["GET shelters", "POST sos", "GET route"]
    if a.no_sos:
        w[0], w[1] = w[0] + w[1], 0
    plan = random.choices(kinds, weights=w, k=a.requests)
    results: list = []
    srv = Server(a.base_url, a.timeout)
    if True:  # (kept as a block to share the indentation of the original)
        gate = asyncio.Event()
        tasks = []
        for k in plan:
            lat, lng = random.uniform(BAKU[0], BAKU[1]), random.uniform(BAKU[2], BAKU[3])
            body = {"citizenId": str(uuid.uuid4()), "type": random.choice(TYPES), "lat": lat, "lng": lng, "note": "loadtest"}
            tasks.append(asyncio.create_task(one(srv, k, body, {"fromLat": lat, "fromLng": lng}, results, gate)))
        await asyncio.sleep(0.2)
        t0 = time.perf_counter()
        gate.set()
        await asyncio.gather(*tasks)
        wall = time.perf_counter() - t0
    errors = report(results, wall, a.requests, kinds)
    limited = sum(1 for r in results if r[1] == "429")
    print(f"\nrate-limited (429, expected) {limited}   errors {len(errors)} {dict(Counter(r[1] for r in errors))}")
    return 1 if errors else 0


def _worker(chunk: list, base_url: str, timeout: float, start_at: float, q):
    """One load-generator process: fires its share of the plan at the absolute wall-clock time `start_at`."""
    async def run():
        srv, results = Server(base_url, timeout), []

        async def fire(k, b, p, delay):  # delay 0 = burst (everything in the same instant), else paced
            await asyncio.sleep(max(0.0, start_at + delay - time.time()))
            gate = asyncio.Event()
            gate.set()
            await one(srv, k, b, p, results, gate)

        await asyncio.gather(*[fire(k, b, p, d) for k, b, p, d in chunk])
        return results

    q.put(asyncio.run(run()))


def build_flood_plan(sos_n: int, other_n: int) -> list[tuple]:
    hot = [(random.uniform(BAKU[0], BAKU[1]), random.uniform(BAKU[2], BAKU[3])) for _ in range(5)]  # 5 hot spots
    plan: list[tuple] = []
    seen: list[tuple[str, str]] = []
    for _ in range(sos_n):
        cid, t = str(uuid.uuid4()), random.choice(TYPES)
        if seen and random.random() < 0.10:  # ~10 % repeat an earlier citizen + type (duplicate)
            cid, t = random.choice(seen)
        else:
            seen.append((cid, t))
        lat, lng = random.choice(hot) if random.random() < 0.25 else (  # ~25 % from the same coordinates
            random.uniform(BAKU[0], BAKU[1]), random.uniform(BAKU[2], BAKU[3]))
        plan.append(("POST sos", {"citizenId": cid, "type": t, "lat": lat, "lng": lng, "note": "flood"}, None))
    for _ in range(other_n):
        lat, lng = random.uniform(BAKU[0], BAKU[1]), random.uniform(BAKU[2], BAKU[3])
        if random.random() < 0.5:
            plan.append(("GET shelters", None, None))
        else:
            plan.append(("GET route", None, {"fromLat": lat, "fromLng": lng}))
    random.shuffle(plan)
    return plan


async def flood(a):
    plan = build_flood_plan(a.flood_sos, a.flood_other)
    total = len(plan)
    dash: list[float] = []
    dash_status: Counter = Counter()
    srv = Server(a.base_url, a.timeout)
    st, raw = await srv.request("POST", "/api/auth/login", body={"username": "dispatcher", "password": "dispatcher123"})
    assert st == 200, f"login failed: {st}"
    auth = {"Authorization": "Bearer " + json.loads(raw)["token"]}
    before = json.loads((await srv.request("GET", "/api/dashboard", headers=auth))[1])

    # The flood comes from several processes (a real attack comes from many machines; one Python client process
    # would itself be the bottleneck and inflate every latency). The dashboard poll runs in this (parent) process.
    ctx = multiprocessing.get_context("spawn")
    q = ctx.Queue()
    start_at = time.time() + 2.5 + 0.3 * a.procs  # all workers are up and connected-ready by then
    timed = [(k, b, p, i * a.pace_seconds / total) for i, (k, b, p) in enumerate(plan)]  # pace 0 -> all delays 0
    procs = [ctx.Process(target=_worker, args=(timed[i::a.procs], a.base_url, a.timeout, start_at, q)) for i in range(a.procs)]
    for p in procs:
        p.start()
    stop = asyncio.Event()

    async def poll():  # the dispatcher UI: must stay responsive while the flood is being processed
        while not stop.is_set():
            t0 = time.perf_counter()
            try:
                st, _ = await srv.request("GET", "/api/dashboard", headers=auth)
                dash_status[st] += 1
            except Exception as e:
                dash_status[type(e).__name__] += 1
            dash.append((time.perf_counter() - t0) * 1000)
            await asyncio.sleep(0.2)

    await asyncio.sleep(max(0.0, start_at - time.time()))
    t0 = time.perf_counter()
    poller = asyncio.create_task(poll())
    parts = await asyncio.gather(*[asyncio.to_thread(q.get) for _ in procs])
    wall = time.perf_counter() - t0
    stop.set()
    await poller
    for p in procs:
        p.join()
    results = [r for part in parts for r in part]
    after = json.loads((await srv.request("GET", "/api/dashboard", headers=auth))[1])

    print(f"({a.procs} load-generator processes, " + (f"paced over {a.pace_seconds:g} s)" if a.pace_seconds else "burst: all released at once)"), end="")
    errors = report(results, wall, total, ["POST sos", "GET shelters", "GET route"])
    avg = statistics.fmean(r[2] for r in results)
    five = [r for r in results if r[1].startswith("5")]
    print("\ndispatcher dashboard polled every 200 ms during the flood (GET /api/dashboard):")
    print(HEADER)
    print(stats_line("dashboard", dash, str(dict(dash_status))))
    slow = sum(1 for m in dash if m >= 300)
    print(f"  polls >= 300 ms: {slow}/{len(dash)}")
    sb, sa = before.get("stats", {}), after.get("stats", {})
    print(f"\ndashboard stats before -> after: activeSos {sb.get('activeSos')} -> {sa.get('activeSos')}, "
          f"suspiciousSos {sb.get('suspiciousSos', 'n/a')} -> {sa.get('suspiciousSos', 'n/a')}, "
          f"flood {sa.get('flood', 'n/a')}, dashboard.sos items {len(after.get('sos', []))}")
    print(f"\nTARGET overall avg < {a.target_avg_ms:.0f} ms: {avg:.0f} ms -> {'OK' if avg < a.target_avg_ms else 'MISSED'}")
    print(f"TARGET 0 x 5xx / errors: {len(five)} x 5xx, {len(errors)} errors {dict(Counter(r[1] for r in errors))} "
          f"-> {'OK' if not errors else 'MISSED'}")
    dash_ok = bool(dash) and pct(dash, 95) < 300 and all(str(k) == "200" for k in dash_status)
    print(f"TARGET dashboard p95 < 300 ms during flood: p95 {pct(dash, 95):.0f} ms -> {'OK' if dash_ok else 'MISSED'}")
    return 0 if (avg < a.target_avg_ms and not errors and dash_ok) else 1


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", choices=["mix", "flood"], default="mix")
    ap.add_argument("--base-url", default="http://127.0.0.1:8000")
    ap.add_argument("--requests", type=int, default=200, help="mix scenario: number of requests")
    ap.add_argument("--mix", default="60,10,30", help="mix scenario: percent GET shelters, POST sos, GET route")
    ap.add_argument("--no-sos", action="store_true", help="mix scenario: replace POST sos by GET shelters")
    ap.add_argument("--procs", type=int, default=4, help="flood scenario: number of load-generator processes")
    ap.add_argument("--pace-seconds", type=float, default=0.0, help="flood scenario: spread the requests evenly over N s (0 = burst)")
    ap.add_argument("--flood-sos", type=int, default=600)
    ap.add_argument("--flood-other", type=int, default=200)
    ap.add_argument("--target-avg-ms", type=float, default=300.0)
    ap.add_argument("--timeout", type=float, default=30.0)
    a = ap.parse_args()
    raise SystemExit(await (flood(a) if a.scenario == "flood" else mix(a)))


if __name__ == "__main__":
    asyncio.run(main())
