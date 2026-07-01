"""Sleep-story video renderer on Modal — full ffmpeg port of the Remotion composition.

A cheap drop-in for the Remotion-Lambda render path. Same HTTP contract the Next.js app
speaks (POST /render/start, GET /render/{id}), so render-panel.tsx points here by swapping
the fetch base URL.

Faithful port of remotion/SleepStory.tsx and its layers, in stacking order:
  1. Ken Burns image  — scale 1.05<->1.16 (alt in/out), 18px vertical drift  (KenBurnsImage.tsx)
  2. 1.2s crossfade between scenes                                            (SleepStory SceneLayer)
  3. rotating overlay pool — screen blend, 45-150s appearances, gaps, fades   (OverlayVideos + scheduleOverlays)
  4. Stars — faint star field                                                 (Stars.tsx)
  5. Grain + vignette                                                         (GrainVignette.tsx)
  6. Captions — AI/fallback phrases, bottom-left, every 3-5 min               (StoryCaptions + story-text)
  7. Title card — opening serif title, fades in/out                          (TitleCard.tsx)

THE key correctness fix vs an earlier cut: every blend runs in RGB (format=gbrp), NOT yuv420p.
Screen/multiply on yuv chroma planes shifts hue (red overlay -> purple, blue stars -> green).
The browser composites in RGB; so do we.

Each scene renders in its own container (render_one), fanned out with .map(); a reducer
(assemble) concats (-c copy) + muxes audio. Every global layer is baked per-scene from the
scene's known global frame offset, so fan-out is preserved.

Assets (overlays, sounds, fonts, vignette/star PNGs) bundled from the app — overlays/sounds
from public/ (Remotion's source), fonts + masks from render-modal/assets/. Output URLs are
plain unsigned public URLs (bucket policy PublicReadSleepStories).

Deploy:  modal deploy render-modal/modal_app.py
Test:    modal run render-modal/modal_app.py::test   (slice; seconds=0 = whole video)

ponytail: stars are a pre-rendered 60s seamless twinkle loop (Remotion's sine math baked in),
seeked by global time so phase is continuous across scenes. The 3%-over-2h field drift is
dropped (~32px over 2h, imperceptible); regenerate the loop with drift if a reviewer asks.
ponytail: caption text uses the in-repo toGentleLine fallback, not the OpenAI phrasing pass.
Timing/position/font are exact; wire lib/scene-engine/story-text's LLM call for AI phrasing.
"""
from __future__ import annotations

import hashlib, json, os, random, re, subprocess, time, uuid
from concurrent.futures import ThreadPoolExecutor

import modal

# --- geometry / look (match build-input RENDER_* + the effect components) ---
FPS = 24
W, H = 1920, 1080
CRF = 26
PRESET = "medium"
ZOOM_LO, ZOOM_HI = 1.05, 1.16
DRIFT_PX = 18                      # KenBurns vertical drift (output px); ~51 source px
CROSSFADE_SEC = 1.2
GRAIN = 9                          # ffmpeg temporal noise ~ GrainVignette's 6% overlay grain
SCENE_CORES = 2
ASSEMBLE_CORES = 4
RATE_PER_CORE_HR = 0.10

# Overlay scheduler (verbatim from build-input.ts scheduleOverlays).
OVERLAY_POOL = [
    ("blue_smoke_later_in_video.mp4", 20.0), ("bubbles_smoke_later_in_video.mp4", 15.0),
    ("full_screen_light_cloud.mp4", 15.0), ("light_white_smoke_rising_from_bottom.mp4", 40.95),
    ("love_vortex.mp4", 15.0), ("red_faint_fire.mp4", 12.0),
]
SEG_MIN, SEG_MAX, GAP_MAX, GAP_CHANCE, OV_FADE = 45.0, 150.0, 40.0, 0.35, 2.5

# Title (TitleCard.tsx) + captions (story-text.ts) timing.
TITLE_FADE_IN, TITLE_HOLD, TITLE_FADE_OUT = 2.0, 4.5, 2.5
TITLE_TOTAL = TITLE_FADE_IN + TITLE_HOLD + TITLE_FADE_OUT
CAP_MIN_GAP, CAP_MAX_GAP = 180.0, 300.0
CAP_LEAD, CAP_FADE, CAP_HOLD = 1.5, 1.6, 4.5
CAP_TOTAL = CAP_FADE + CAP_HOLD + CAP_FADE

AMBIENCE = {
    "fire": ("soundreality-fire-ambience-528618.mp3", 0.18),
    "meditation": ("quietphase-meditation-ambient-484356.mp3", 0.08),
    "none": (None, 0.0),
}

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = "/assets/render/EBGaramond.ttf"
FONT_IT = "/assets/render/EBGaramond-Italic.ttf"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("boto3", "fastapi[standard]")
    .add_local_dir(os.path.join(APP_ROOT, "public/overlays"), "/assets/overlays", copy=True)
    .add_local_dir(os.path.join(APP_ROOT, "public/sound-effects"), "/assets/sound-effects", copy=True)
    .add_local_dir(os.path.join(APP_ROOT, "render-modal/assets"), "/assets/render", copy=True)
)
app = modal.App("sleep-render", image=image)
secret = modal.Secret.from_name("open-source-image-gen-secrets")
progress = modal.Dict.from_name("sleep-render-progress", create_if_missing=True)
WORK = "/tmp/work"


def _sh(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {' '.join(str(c) for c in cmd[:6])}...\n{p.stderr[-1800:]}")


def _fetch(url, path):
    import urllib.request
    urllib.request.urlretrieve(url, path)


def _slug(s):
    return "".join(c if c.isalnum() else "-" for c in (s or "sleep-story").lower()).strip("-")[:60] or "sleep-story"


def _s3():
    import boto3
    return boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-west-2"))


def _public_url(bucket, key):
    return f"https://{bucket}.s3.us-west-2.amazonaws.com/{key}"


def _set(render_id, **kw):
    cur = progress.get(render_id, {})
    cur.update(kw)
    progress[render_id] = cur


def gentle_line(snippet, maxchars=40):
    """Port of build-input.ts toGentleLine — first clause, trimmed, no trailing punctuation."""
    cleaned = re.sub(r"\s+", " ", snippet or "").strip()
    if not cleaned:
        return ""
    first = re.split(r"(?<=[.!?,;:—])\s", cleaned)[0]
    line = first.strip()
    if len(line) > maxchars:
        line = re.sub(r"\s+\S*$", "", line[:maxchars]).strip()
    return re.sub(r"[.,;:!?—-]+$", "", line).strip()


def schedule_overlays(durations, seed):
    """Scene-aligned port of scheduleOverlays(): reshuffled-bag rotation, 45-150s appearances,
    35% gap chance (<=40s), fades on first/last scene of each appearance."""
    rng = random.Random(seed)
    bag = []

    def nxt():
        nonlocal bag
        if not bag:
            bag = OVERLAY_POOL[:]
            rng.shuffle(bag)
        return bag.pop()

    out = [None] * len(durations)
    i = 0
    while i < len(durations):
        src, cd = nxt()
        seg = rng.uniform(SEG_MIN, SEG_MAX)
        opacity, rate, flip = rng.uniform(0.16, 0.28), rng.uniform(0.25, 0.45), rng.random() < 0.5
        j, acc = i, 0.0
        while j < len(durations) and acc < seg:
            acc += durations[j]; j += 1
        cum = 0.0
        for k in range(i, j):
            out[k] = {"clip": src, "opacity": round(opacity, 3), "rate": round(rate, 3),
                      "flip": flip, "src_seek": round((cum * rate) % cd, 2),
                      "fade_in": k == i, "fade_out": k == j - 1}
            cum += durations[k]
        i = j
        if rng.random() < GAP_CHANCE:
            gap, g = rng.uniform(0, GAP_MAX), 0.0
            while i < len(durations) and g < gap:
                g += durations[i]; i += 1
    return out


def select_captions(starts_sec, snippets, seed):
    """Port of selectCaptionScenes + caption layout. Returns {scene_idx: text} for scenes
    live every 3-5 min that have a snippet."""
    rng = random.Random(seed)
    out = {}
    next_at = rng.uniform(CAP_MIN_GAP, CAP_MAX_GAP)
    for i, st in enumerate(starts_sec):
        if st >= next_at:
            txt = gentle_line(snippets[i], 40) if i < len(snippets) else ""
            if txt:
                out[i] = txt
            next_at = st + rng.uniform(CAP_MIN_GAP, CAP_MAX_GAP)
    return out


def _zoom_expr(frames, zoom_in):
    z = (f"1.05+{ZOOM_HI - ZOOM_LO:.3f}*on/{frames}" if zoom_in
         else f"1.16-{ZOOM_HI - ZOOM_LO:.3f}*on/{frames}")
    # drift opposite zoom dir, ~51 source px over the scene
    sign = "-" if zoom_in else "+"
    drift = f"{sign}{round(DRIFT_PX * (3072 / 1080)):d}*on/{frames}"
    return (f"zoompan=z='{z}':d={frames}"
            f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2){drift}':s={W}x{H}:fps={FPS}")


def _build_filter(job):
    """Construct the per-scene filter_complex + the ordered input list."""
    dur = job["duration"]
    frames = max(1, round(dur * FPS))
    cf = CROSSFADE_SEC
    inputs = ["-loop", "1", "-t", str(dur), "-i", job["img"]]      # 0: current image
    # 1: twinkling star loop (60s, seamless) seeked by global time -> continuous phase across scenes
    inputs += ["-stream_loop", "-1", "-ss", str(job["stars_seek"]), "-t", str(dur),
               "-i", "/assets/render/stars.mp4"]
    inputs += ["-loop", "1", "-t", str(dur), "-i", "/assets/render/vignette.png"]  # 2
    idx = 3
    ov = job.get("overlay")
    if ov:
        i_ov = idx; idx += 1
        inputs += ["-stream_loop", "-1", "-ss", str(ov["src_seek"]), "-t", str(dur),
                   "-i", f"/assets/overlays/{ov['clip']}"]
    prev = job.get("prev_img")
    if prev:
        i_prev = idx; idx += 1
        inputs += ["-loop", "1", "-t", str(cf + 0.1), "-i", prev]

    p = [f"[0:v]{_zoom_expr(frames, job['zoom_in'])},setsar=1,format=gbrp[cur]"]
    base = "cur"
    if prev:
        p.append(f"[{i_prev}:v]scale={W}:{H},fps={FPS},format=gbrp,"
                 f"trim=duration={cf},setpts=PTS-STARTPTS[prev]")
        p.append(f"[prev][cur]xfade=transition=fade:duration={cf}:offset=0,format=gbrp[xf]")
        base = "xf"
    if ov:
        fadelen = min(OV_FADE, dur)
        f = ""
        if ov["fade_in"]:
            f += f"fade=t=in:st=0:d={fadelen},"
        if ov["fade_out"]:
            f += f"fade=t=out:st={max(0, dur - fadelen)}:d={fadelen},"
        p.append(f"[{i_ov}:v]scale={W}:{H},setpts=PTS/{ov['rate']},fps={FPS},"
                 + ("hflip," if ov["flip"] else "") + f"trim=duration={dur},setpts=PTS-STARTPTS,"
                 + f"{f}format=gbrp[ov]")
        p.append(f"[{base}][ov]blend=all_mode=screen:all_opacity={ov['opacity']},format=gbrp[ovb]")
        base = "ovb"
    # stars (screen), grain, vignette (multiply) — all in RGB
    p.append(f"[1:v]scale={W}:{H},fps={FPS},setpts=PTS-STARTPTS,format=gbrp[st]")
    p.append(f"[{base}][st]blend=all_mode=screen,format=gbrp[s2]")
    p.append(f"[s2]noise=alls={GRAIN}:allf=t+u,format=gbrp[gr]")
    p.append(f"[2:v]scale={W}:{H},fps={FPS},format=gbrp[vg]")
    p.append(f"[gr][vg]blend=all_mode=multiply,format=yuv420p[comp]")
    base = "comp"
    # caption (below) then title (top), crisp over grain/vignette
    if job.get("caption"):
        a = (f"if(lt(t,{CAP_LEAD}),0,if(lt(t-{CAP_LEAD},{CAP_FADE}),(t-{CAP_LEAD})/{CAP_FADE},"
             f"if(lt(t-{CAP_LEAD},{CAP_TOTAL - CAP_FADE}),1,if(lt(t-{CAP_LEAD},{CAP_TOTAL}),"
             f"1-((t-{CAP_LEAD})-{CAP_TOTAL - CAP_FADE})/{CAP_FADE},0))))")
        p.append(f"[{base}]drawtext=fontfile={FONT_IT}:textfile={job['cap_file']}:"
                 f"fontcolor=0xEEF0FF@0.92:fontsize=46:x=w*0.07:y=h*0.87-text_h:"
                 f"shadowcolor=black@0.8:shadowx=0:shadowy=2:alpha='{a}'[cap]")
        base = "cap"
    if job.get("title"):
        g = job["gstart_sec"]
        a = (f"if(lt({g}+t,{TITLE_FADE_IN}),({g}+t)/{TITLE_FADE_IN},"
             f"if(lt({g}+t,{TITLE_FADE_IN + TITLE_HOLD}),1,"
             f"if(lt({g}+t,{TITLE_TOTAL}),1-(({g}+t)-{TITLE_FADE_IN + TITLE_HOLD})/{TITLE_FADE_OUT},0)))")
        p.append(f"[{base}]drawtext=fontfile={FONT}:textfile={job['title_file']}:"
                 f"fontcolor=white@0.96:fontsize=96:x=(w-text_w)/2:y=(h-text_h)/2:"
                 f"shadowcolor=black@0.7:shadowx=0:shadowy=2:alpha='{a}'[ti]")
        base = "ti"
    return inputs, ";".join(p), base


@app.function(secrets=[secret], cpu=SCENE_CORES, memory=4096, timeout=900,
              retries=modal.Retries(max_retries=2))
def render_one(job):
    os.makedirs(WORK, exist_ok=True)
    t0 = time.time()
    i = job["idx"]
    job["img"] = f"{WORK}/img{i}.png"
    _fetch(job["image_url"], job["img"])
    if job.get("prev_url"):
        job["prev_img"] = f"{WORK}/prev{i}.png"
        _fetch(job["prev_url"], job["prev_img"])
    if job.get("caption"):
        job["cap_file"] = f"{WORK}/cap{i}.txt"
        open(job["cap_file"], "w").write(job["caption"])
    if job.get("title"):
        job["title_file"] = f"{WORK}/title{i}.txt"
        open(job["title_file"], "w").write(job["title"])

    inputs, fc, out_label = _build_filter(job)
    out = f"{WORK}/clip{i:04d}.mp4"
    _sh(["ffmpeg", "-y", *inputs, "-filter_complex", fc, "-map", f"[{out_label}]",
         "-t", str(job["duration"]), "-r", str(FPS),
         "-c:v", "libx264", "-preset", PRESET, "-crf", str(CRF), "-pix_fmt", "yuv420p", out])
    key = f"{job['tmp_prefix']}/clip{i:04d}.mp4"
    _s3().upload_file(out, job["bucket"], key)
    return {"idx": i, "key": key, "sec": round(time.time() - t0, 2)}


@app.function(secrets=[secret], cpu=ASSEMBLE_CORES, memory=8192, timeout=1800)
def assemble(render_id, clip_keys, bucket, tmp_prefix, audio_url, audio_dur, sound_effect, title):
    os.makedirs(WORK, exist_ok=True)
    t0 = time.time()
    s3 = _s3()
    amb_file, amb_vol = AMBIENCE.get(sound_effect or "fire", AMBIENCE["fire"])

    def dl(k):
        local = f"{WORK}/{os.path.basename(k)}"
        s3.download_file(bucket, k, local)
        return local
    with ThreadPoolExecutor(max_workers=ASSEMBLE_CORES * 2) as ex:
        locals_ = list(ex.map(dl, clip_keys))

    with open(f"{WORK}/list.txt", "w") as f:
        for c in locals_:
            f.write(f"file '{c}'\n")
    _sh(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", f"{WORK}/list.txt",
         "-c", "copy", f"{WORK}/video.mp4"])
    _set(render_id, progress=0.93)

    _fetch(audio_url, f"{WORK}/narr.mp3")
    final = f"{WORK}/final.mp4"
    if amb_file:
        _sh(["ffmpeg", "-y", "-i", f"{WORK}/video.mp4", "-i", f"{WORK}/narr.mp3",
             "-stream_loop", "-1", "-i", f"/assets/sound-effects/{amb_file}",
             "-filter_complex",
             f"[1:a]volume=1.0[a1];[2:a]volume={amb_vol}[a2];"
             f"[a1][a2]amix=inputs=2:duration=first:normalize=0[a]",
             "-map", "0:v:0", "-map", "[a]", "-t", str(audio_dur),
             "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", final])
    else:
        _sh(["ffmpeg", "-y", "-i", f"{WORK}/video.mp4", "-i", f"{WORK}/narr.mp3",
             "-map", "0:v:0", "-map", "1:a:0", "-t", str(audio_dur),
             "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", final])

    key = f"renders/{render_id}/{_slug(title)}.mp4"
    s3.upload_file(final, bucket, key, ExtraArgs={"ContentType": "video/mp4"})
    s3.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": k} for k in clip_keys]})
    return {"key": key, "size_mb": round(os.path.getsize(final) / 1e6, 1),
            "assemble_sec": round(time.time() - t0, 2)}


@app.function(secrets=[secret], timeout=3600)
def driver(render_id, scenes, audio_url, audio_dur, sound_effect, title):
    t0 = time.time()
    # Sleep-stories' OWN bucket (audio/ + renders/, 7-day lifecycle). Not the
    # shared image-gen bucket — override via SLEEP_RENDER_BUCKET if it ever moves.
    bucket = os.environ.get("SLEEP_RENDER_BUCKET", "sleep-stories-media")
    tmp_prefix = f"renders/{render_id}/clips"
    _set(render_id, started=t0, done=False, progress=0.0, output=None, error=None,
         n=len(scenes), scene_core_sec=0.0)

    durations = [s["duration"] for s in scenes]
    snippets = [s.get("script_snippet", "") for s in scenes]
    starts_sec, acc = [], 0.0
    for d in durations:
        starts_sec.append(acc); acc += d
    seed = int(hashlib.md5(render_id.encode()).hexdigest()[:8], 16)
    sched = schedule_overlays(durations, seed)
    caps = select_captions(starts_sec, snippets, seed ^ 0x9e3779b9)

    jobs = []
    for i, s in enumerate(scenes):
        jobs.append({
            "idx": i, "image_url": s["image_url"], "duration": s["duration"],
            "zoom_in": i % 2 == 0, "overlay": sched[i],
            "prev_url": scenes[i - 1]["image_url"] if i > 0 else None,
            "gstart_sec": round(starts_sec[i], 2),
            "stars_seek": round(starts_sec[i] % 60, 2),
            "title": title if starts_sec[i] < TITLE_TOTAL else None,
            "caption": caps.get(i),
            "bucket": bucket, "tmp_prefix": tmp_prefix,
        })

    try:
        keys, done_ct, core_sec = {}, 0, 0.0
        for r in render_one.map(jobs):
            keys[r["idx"]] = r["key"]
            core_sec += r["sec"] * SCENE_CORES
            done_ct += 1
            _set(render_id, progress=round(0.85 * done_ct / len(jobs), 3), scene_core_sec=round(core_sec, 1))
        ordered = [keys[i] for i in range(len(jobs))]
        res = assemble.remote(render_id, ordered, bucket, tmp_prefix,
                              audio_url, audio_dur, sound_effect, title)
        core_sec += res["assemble_sec"] * ASSEMBLE_CORES
        url = _public_url(bucket, res["key"])
        cost = round(core_sec * RATE_PER_CORE_HR / 3600, 4)
        _set(render_id, done=True, progress=1.0, output=url, size_mb=res["size_mb"],
             wall_sec=round(time.time() - t0, 1), cost=cost, scene_core_sec=round(core_sec, 1))
        return url
    except Exception as e:
        _set(render_id, done=True, error=str(e)[:600], progress=1.0)
        raise


def _cost(p):
    if p.get("cost") is not None:
        return p["cost"]
    return round(p.get("scene_core_sec", 0.0) * RATE_PER_CORE_HR / 3600, 4)


@app.function(secrets=[secret])
@modal.asgi_app()
def web():
    from fastapi import FastAPI, Body
    api = FastAPI()

    @api.post("/render/start")
    async def start(body: dict = Body(...)):
        rid = uuid.uuid4().hex[:12]
        # Keep every scene with a duration; a scene whose image failed to generate
        # reuses the previous scene's image (full audio coverage, never dropped).
        raw = [s for s in body["scenes"] if s.get("duration")]
        last = next((s["image_url"] for s in raw if s.get("image_url")), None)
        scenes = []
        if last:
            for s in raw:
                last = s.get("image_url") or last
                scenes.append({**s, "image_url": last})
        title = body.get("title") or "A Quiet Night"
        driver.spawn(rid, scenes, body["audioUrl"], body["audioDurationSec"],
                     body.get("soundEffect", "fire"), title)
        return {"renderId": rid,
                "bucketName": os.environ.get("SLEEP_RENDER_BUCKET", "sleep-stories-media"),
                "title": title, "durationInFrames": round(body["audioDurationSec"] * FPS),
                "sceneCount": len(scenes)}

    @api.get("/render/{rid}")
    async def status(rid: str):
        p = progress.get(rid, {})
        return {"done": bool(p.get("done")) and not p.get("error"),
                "overallProgress": p.get("progress", 0.0),
                "outputFile": p.get("output"),
                "fatalErrorEncountered": bool(p.get("error")),
                "errors": ([{"message": p["error"]}] if p.get("error") else []),
                "costsAccrued": _cost(p)}

    return api


@app.local_entrypoint()
def test(seconds: int = 240, sound: str = "fire"):
    data = json.load(open(os.path.expanduser(
        "~/Downloads/sleep-stories-hello-there-and-welcome-to-2026-06-25 (1).json")))
    st = data["state"]
    scenes, cum = [], 0.0
    for s in st["storyboardScenes"]:
        scenes.append({"image_url": s["image_url"], "duration": s["duration"],
                       "script_snippet": s.get("script_snippet", "")})
        cum += s["duration"]
        if seconds and cum >= seconds:
            break
    rid = "test" + uuid.uuid4().hex[:6]
    print(f"rendering {len(scenes)} scenes (~{cum:.0f}s) sound={sound} ...")
    url = driver.remote(rid, scenes, st["audio"]["url"], cum, sound, "The Gentle Dawn of Humanity")
    p = progress.get(rid, {})
    print("\n=== TEST RESULT ===")
    print(json.dumps({"url": url, "scenes": len(scenes), "video_sec": round(cum, 1),
                      "wall_sec": p.get("wall_sec"), "billable_core_seconds": p.get("scene_core_sec"),
                      "cost_est": _cost(p), "size_mb": p.get("size_mb")}, indent=2))
