# image.py (updated prompt generation -> local SSD-1B)
from flask import Flask, render_template, request, jsonify
from rembg import remove
from PIL import Image
import os
import uuid
import subprocess
import sys
import base64
import io
import threading
import traceback

# diffusers + torch for local generation (SSD-1B)
from diffusers import StableDiffusionXLPipeline
import torch

app = Flask(__name__, static_folder="static", template_folder="templates")

# Folders
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = app.static_folder
UPLOAD_DIR = os.path.join(STATIC_DIR, "uploads")
TRIPOSR_OUT_DIR = os.path.join(STATIC_DIR, "triposr")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(TRIPOSR_OUT_DIR, exist_ok=True)

# Path to TripoSR repo (we assume image.py lives there with run.py)
TRIPOSR_DIR = BASE_DIR

ALLOWED_EXT = {"png", "jpg", "jpeg", "webp", "bmp"}

# -------------------------------
# Local model settings (SSD-1B)
# -------------------------------
# Model id used by diffusers. Make sure you have previously downloaded it to HF cache:
LOCAL_MODEL_ID = "segmind/SSD-1B"
# You can lower steps for speed on CPU
DEFAULT_INFERENCE_STEPS = 20
DEFAULT_GUIDANCE_SCALE = 7.0
# Lazy-loaded pipeline (global)
_local_pipe = None
_pipe_lock = threading.Lock()


def get_local_pipe():
    """
    Lazily load the StableDiffusion pipeline once (CPU mode).
    Returns a StableDiffusionPipeline on CPU.
    """
    global _local_pipe
    if _local_pipe is not None:
        return _local_pipe

    with _pipe_lock:
        if _local_pipe is not None:
            return _local_pipe
        try:
            print(f"[model] Loading local model {LOCAL_MODEL_ID} on CPU (this may take a minute)...")
            # Use float32 on CPU
            pipe = StableDiffusionXLPipeline.from_pretrained(
                LOCAL_MODEL_ID,
                torch_dtype=torch.float32,
                use_safetensors=True,
                variant=None,
                safety_checker=None
            )

            pipe.to("cpu")
            pipe.enable_attention_slicing()

            # CPU memory optimizations
            try:
                pipe.enable_attention_slicing()
            except Exception:
                pass
            _local_pipe = pipe
            print("[model] Local model loaded.")
            return _local_pipe
        except Exception as e:
            print("[model] Failed to load local model:", e)
            traceback.print_exc()
            raise


def allowed_file(name: str) -> bool:
    return "." in name and name.rsplit(".", 1)[1].lower() in ALLOWED_EXT


@app.route("/")
def index():
    return render_template("index.html")


# ---------- Upload + BG removal (original flow) ----------


@app.route("/upload", methods=["POST"])
def upload():
    """
    Original upload endpoint: expects both background and foreground files (file-based flow).
    """
    img1 = request.files.get("image1")  # background
    img2 = request.files.get("image2")  # foreground

    if not img1 or not img2:
        return jsonify({"error": "Missing files"}), 400

    if not allowed_file(img1.filename) or not allowed_file(img2.filename):
        return jsonify({"error": "Unsupported file format"}), 400

    uid_bg = uuid.uuid4().hex
    uid_fg = uuid.uuid4().hex

    bg_path = os.path.join(UPLOAD_DIR, f"{uid_bg}_bg.png")
    fg_raw_path = os.path.join(UPLOAD_DIR, f"{uid_fg}_raw.png")
    fg_nobg_path = os.path.join(UPLOAD_DIR, f"{uid_fg}_nobg.png")

    # Save background
    Image.open(img1.stream).convert("RGBA").save(bg_path, "PNG")

    # Save foreground raw
    Image.open(img2.stream).convert("RGBA").save(fg_raw_path, "PNG")

    # Remove BG from foreground
    fg_in = Image.open(fg_raw_path).convert("RGBA")
    fg_out = remove(fg_in)
    fg_out.save(fg_nobg_path, "PNG")

    bg_url = "/static/uploads/" + os.path.basename(bg_path)
    fg_url = "/static/uploads/" + os.path.basename(fg_nobg_path)

    return jsonify({"image1": bg_url, "image2_nobg": fg_url})


# ---------- Replaced: Prompt -> generate FG (local SSD-1B) ----------
@app.route("/prompt_fg", methods=["POST"])
def prompt_fg():
    """
    Accepts form param 'prompt' and optional 'keep_shadows' (bool '1'/'0').
    Generates an image with the local SSD-1B model, saves PNG -> runs rembg -> returns fg url.
    This replaces the previous remote SDXL HuggingFace call with a local generator suitable for CPU.
    """
    prompt = request.form.get("prompt", "").strip()
    keep_shadows = request.form.get("keep_shadows", "0")  # "1" => keep shadow, "0" => try to avoid
    steps = int(request.form.get("steps", DEFAULT_INFERENCE_STEPS))
    guidance = float(request.form.get("guidance_scale", DEFAULT_GUIDANCE_SCALE))

    if not prompt:
        return jsonify({"error": "Missing prompt"}), 400

    # Build prompt template. For clean cutouts we ask for isolated object + plain background.
    prompt_template = prompt
    if keep_shadows == "0":
        prompt_template += ", isolated object, plain background, minimal shadows, studio lighting"

    # Generate using local pipeline (lazy-load)
    try:
        pipe = get_local_pipe()
    except Exception as e:
        return jsonify({"error": f"Local model load failed: {e}"}), 500

    try:
        # Run generation on CPU
        generation = pipe(
            prompt_template,
            num_inference_steps=max(5, min(40, steps)),
            guidance_scale=max(1.0, min(20.0, guidance))
        )
        image = generation.images[0]
    except Exception as e:
        # Return traceback for debugging
        tb = traceback.format_exc()
        print("[generation] failed:", e, tb)
        return jsonify({"error": f"Local generation failed: {e}", "trace": tb}), 500

    # Save raw image
    try:
        uid = uuid.uuid4().hex
        raw_path = os.path.join(UPLOAD_DIR, f"{uid}_raw_local.png")
        image.save(raw_path)
    except Exception as e:
        return jsonify({"error": f"Failed to save generated image: {e}"}), 500

    # Run background removal
    try:
        im = Image.open(raw_path).convert("RGBA")
        im_nobg = remove(im)
        uid2 = uuid.uuid4().hex
        nobg_path = os.path.join(UPLOAD_DIR, f"{uid2}_nobg_local.png")
        im_nobg.save(nobg_path, "PNG")
    except Exception as e:
        print("[rembg] failed:", e, traceback.format_exc())
        return jsonify({"error": f"Background removal failed: {e}"}), 500

    fg_url = "/static/uploads/" + os.path.basename(nobg_path)
    return jsonify({"fg": fg_url})


# ---------- Blend final 2D image ----------


def blend_images_canvas(bg_path, fg_path, x, y, w, h, canvas_w, canvas_h, out_path):
    bg = Image.open(bg_path).convert("RGBA")
    fg = Image.open(fg_path).convert("RGBA")

    canvas_w = int(canvas_w)
    canvas_h = int(canvas_h)
    x = int(x)
    y = int(y)
    w = int(w)
    h = int(h)

    base = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))

    # Scale BG to fit canvas and center it
    scale = min(canvas_w / bg.width, canvas_h / bg.height)
    bw = int(bg.width * scale)
    bh = int(bg.height * scale)
    bg_resized = bg.resize((bw, bh), Image.LANCZOS)

    bx = (canvas_w - bw) // 2
    by = (canvas_h - bh) // 2
    base.paste(bg_resized, (bx, by), bg_resized)

    # FG resized to (w, h)
    fg_resized = fg.resize((w, h), Image.LANCZOS)

    # Clamp position
    x = max(0, min(x, canvas_w - w))
    y = max(0, min(y, canvas_h - h))

    base.paste(fg_resized, (x, y), fg_resized)
    base.convert("RGB").save(out_path, "PNG")


@app.route("/blend", methods=["POST"])
def blend():
    bg_url = request.form.get("bg")
    fg_url = request.form.get("fg")

    if not bg_url or not fg_url:
        return jsonify({"error": "Missing image URLs"}), 400

    # Convert URLs like /static/uploads/foo.png to file paths
    def url_to_path(u: str) -> str:
        if u.startswith("/static/"):
            rel = u[len("/static/") :]
        else:
            rel = u.lstrip("/")
        return os.path.join(STATIC_DIR, rel)

    bg_path = url_to_path(bg_url)
    fg_path = url_to_path(fg_url)

    x = float(request.form.get("x", 0))
    y = float(request.form.get("y", 0))
    w = float(request.form.get("w", 0))
    h = float(request.form.get("h", 0))
    canvas_w = float(request.form.get("canvas_w", 900))
    canvas_h = float(request.form.get("canvas_h", 550))

    out_name = f"final_{uuid.uuid4().hex}.png"
    out_path = os.path.join(UPLOAD_DIR, out_name)

    blend_images_canvas(bg_path, fg_path, x, y, w, h, canvas_w, canvas_h, out_path)

    final_url = "/static/uploads/" + os.path.basename(out_path)
    return jsonify({"final": final_url})


# ---------- TripoSR integration (3D) ----------


def run_triposr(image_path: str):
    """
    Run TripoSR on image_path.
    Returns (model_url, render_url, texture_url) as /static/... or (None, None, None).
    """
    run_id = uuid.uuid4().hex[:8]
    out_dir = os.path.join(TRIPOSR_OUT_DIR, run_id)
    os.makedirs(out_dir, exist_ok=True)

    cmd = [
        sys.executable,
        "run.py",
        image_path,
        "--output-dir",
        out_dir,
        "--bake-texture",
        "--texture-resolution",
        "1024",
    ]

    try:
        subprocess.run(cmd, cwd=TRIPOSR_DIR, check=True)
    except Exception as e:
        print("[TripoSR ERROR]", e)
        return None, None, None

    model_path = None
    render_path = None
    texture_path = None

    # search recursively inside out_dir
    for root, dirs, files in os.walk(out_dir):
        for fname in files:
            lower = fname.lower()
            full = os.path.join(root, fname)

            if lower.endswith((".obj", ".ply", ".glb", ".gltf")) and model_path is None:
                model_path = full

            if lower.endswith((".png", ".jpg", ".jpeg", ".webp")):
                if "input" in lower and render_path is None:
                    render_path = full
                elif any(k in lower for k in ["tex", "texture", "albedo", "baked"]) and texture_path is None:
                    texture_path = full
                elif render_path is None:
                    render_path = full

    # fallback: if we didn't find a special texture, just reuse render
    if texture_path is None:
        texture_path = render_path

    print("TripoSR outputs:", model_path, render_path, texture_path)

    def to_url(p: str | None) -> str | None:
        if not p:
            return None
        rel = os.path.relpath(p, STATIC_DIR).replace("\\", "/")
        return "/static/" + rel

    return to_url(model_path), to_url(render_path), to_url(texture_path)


@app.route("/triposr", methods=["POST"])
def triposr_route():
    fg_url = request.form.get("fg")
    if not fg_url:
        return jsonify({"error": "Missing foreground URL"}), 400

    if fg_url.startswith("/static/"):
        rel = fg_url[len("/static/") :]
    else:
        rel = fg_url.lstrip("/")

    fg_path = os.path.join(STATIC_DIR, rel)
    if not os.path.exists(fg_path):
        return jsonify({"error": "Foreground image not found"}), 404

    model_url, render_url, texture_url = run_triposr(fg_path)
    if not model_url and not render_url:
        return jsonify({"error": "TripoSR failed"}), 500

    return jsonify({"model": model_url, "render": render_url, "texture": texture_url})


# ---------- Capture 3D view as new foreground ----------


@app.route("/upload_3d_view", methods=["POST"])
def upload_3d_view():
    file = request.files.get("image_data")
    
    if file:
        binary = file.read()
    else:
        data_url = request.form.get("image_data")
        if not data_url:
            return jsonify({"error": "Missing image data"}), 400
        if "," in data_url:
            _, b64 = data_url.split(",", 1)
        else:
            b64 = data_url
        binary = base64.b64decode(b64)

    uid = uuid.uuid4().hex
    out_path = os.path.join(UPLOAD_DIR, f"{uid}_3dview.png")
    with open(out_path, "wb") as f:
        f.write(binary)

    url = "/static/uploads/" + os.path.basename(out_path)
    return jsonify({"fg": url})

if __name__ == "__main__":
    app.run(debug=True)
