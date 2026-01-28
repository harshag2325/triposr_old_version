import os
import uuid
import sys
import subprocess
from typing import Tuple

import gradio as gr
from PIL import Image
from rembg import remove

# ---------- Paths & folders ----------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOAD_DIR = os.path.join(STATIC_DIR, "uploads")
TRIPOSR_OUT_DIR = os.path.join(STATIC_DIR, "triposr")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(TRIPOSR_OUT_DIR, exist_ok=True)

# Folder where run.py (TripoSR entry point) is located
TRIPOSR_DIR = BASE_DIR

# Pillow LANCZOS compatibility (newer versions use Image.Resampling.LANCZOS)
try:
    RESAMPLE_LANCZOS = Image.Resampling.LANCZOS  # type: ignore[attr-defined]
except AttributeError:  # older Pillow
    RESAMPLE_LANCZOS = Image.LANCZOS


# ---------- Utility functions ----------

def remove_bg_pipeline(
    bg_img: Image.Image,
    fg_img: Image.Image,
) -> Tuple[Image.Image, Image.Image, Image.Image, Image.Image]:
    """
    - Save BG and FG to disk
    - Remove BG from FG using rembg
    - Return:
        - bg_preview (PIL RGBA)
        - fg_nobg_preview (PIL RGBA)
        - bg_state (PIL RGBA)
        - fg_state (PIL RGBA)
    """
    if bg_img is None or fg_img is None:
        raise gr.Error("Please upload BOTH background and foreground images.")

    # Generate unique IDs
    bg_id = uuid.uuid4().hex
    fg_id = uuid.uuid4().hex

    # Paths
    bg_path = os.path.join(UPLOAD_DIR, f"{bg_id}_bg.png")
    fg_raw_path = os.path.join(UPLOAD_DIR, f"{fg_id}_raw.png")
    fg_nobg_path = os.path.join(UPLOAD_DIR, f"{fg_id}_nobg.png")

    # Convert to RGBA and save
    bg_img_rgba = bg_img.convert("RGBA")
    fg_img_rgba = fg_img.convert("RGBA")

    bg_img_rgba.save(bg_path, "PNG")
    fg_img_rgba.save(fg_raw_path, "PNG")

    # Remove background from foreground
    try:
        fg_out = remove(fg_img_rgba)  # rembg returns a PIL.Image when input is PIL.Image
    except Exception as e:
        raise gr.Error(f"Background removal failed: {e}")

    # Ensure PIL Image (in case rembg version behaves differently)
    if not isinstance(fg_out, Image.Image):
        try:
            fg_out = Image.open(fg_out)
        except Exception:
            raise gr.Error("Unexpected output type from rembg; could not convert to image.")

    fg_out = fg_out.convert("RGBA")
    fg_out.save(fg_nobg_path, "PNG")

    # Reload as PIL
    bg_pil = Image.open(bg_path).convert("RGBA")
    fg_nobg_pil = Image.open(fg_nobg_path).convert("RGBA")

    # Return previews and states
    return (
        bg_pil.copy(),
        fg_nobg_pil.copy(),
        bg_pil,
        fg_nobg_pil,
    )


def blend_pipeline(
    bg_img: Image.Image,
    fg_img: Image.Image,
    x_off: float,
    y_off: float,
    scale: float,
) -> Image.Image:
    """
    Compose FG over BG with:
      - x_off, y_off in pixels (offset from center)
      - uniform scale factor
    """
    if bg_img is None or fg_img is None:
        raise gr.Error("You must run 'Remove BG & init' first.")

    # Work in RGBA
    bg = bg_img.convert("RGBA")
    fg = fg_img.convert("RGBA")

    W, H = bg.size

    # Guard against invalid scale
    if scale <= 0:
        raise gr.Error("Scale factor must be positive.")

    # Scale foreground
    new_w = max(1, int(fg.width * scale))
    new_h = max(1, int(fg.height * scale))
    fg_resized = fg.resize((new_w, new_h), RESAMPLE_LANCZOS)

    # position is offset from center of background
    cx = W / 2 + x_off
    cy = H / 2 + y_off

    x = int(cx - new_w / 2)
    y = int(cy - new_h / 2)

    # clamp within background (allowing partial outside)
    x = max(-new_w, min(W, x))
    y = max(-new_h, min(H, y))

    base = bg.copy()

    try:
        # alpha_composite with dest=(x, y) is supported in newer Pillow
        base.alpha_composite(fg_resized, (x, y))
    except TypeError:
        # Fallback: manual paste using alpha mask if dest isn't supported
        base.paste(fg_resized, (x, y), fg_resized)

    return base.convert("RGB")


def run_triposr_on_fg(fg_img: Image.Image) -> str:
    """
    Save fg_img, run TripoSR via run.py, return path to a 3D model
    (OBJ / GLB / GLTF) for gr.Model3D.
    """
    if fg_img is None:
        raise gr.Error(
            "You must run 'Remove BG & init' first so we have a foreground without background."
        )

    # Ensure run.py exists
    run_py_path = os.path.join(TRIPOSR_DIR, "run.py")
    if not os.path.isfile(run_py_path):
        raise gr.Error(
            f"Could not find 'run.py' for TripoSR in {TRIPOSR_DIR}. "
            "Please verify that TripoSR is correctly installed and that run.py is present."
        )

    # Save foreground (no BG) as PNG
    fg_id = uuid.uuid4().hex
    fg_path = os.path.join(UPLOAD_DIR, f"{fg_id}_triposr_src.png")
    fg_img.convert("RGBA").save(fg_path, "PNG")

    # Output dir for TripoSR
    run_id = uuid.uuid4().hex[:8]
    out_dir = os.path.join(TRIPOSR_OUT_DIR, run_id)
    os.makedirs(out_dir, exist_ok=True)

    cmd = [
        sys.executable,
        "run.py",
        fg_path,
        "--output-dir",
        out_dir,
        "--bake-texture",
        "--texture-resolution",
        "1024",
    ]

    print("Running TripoSR with command:", " ".join(cmd))
    print("Output directory will be:", out_dir)

    try:
        subprocess.run(cmd, cwd=TRIPOSR_DIR, check=True)
    except FileNotFoundError as e:
        raise gr.Error(
            f"Failed to run TripoSR. Python executable or run.py not found: {e}"
        )
    except subprocess.CalledProcessError as e:
        raise gr.Error(f"TripoSR process exited with an error: {e}")
    except Exception as e:
        raise gr.Error(f"Unexpected error when running TripoSR: {e}")

    # List everything TripoSR produced (for debugging)
    for root, _, files in os.walk(out_dir):
        print("Files in", root, ":", files)

    # Accept any common 3D format that Gradio supports
    exts = (".obj", ".glb", ".gltf")
    model_path = None
    for root, _, files in os.walk(out_dir):
        for fname in files:
            if fname.lower().endswith(exts):
                model_path = os.path.join(root, fname)
                break
        if model_path:
            break

    if not model_path:
        raise gr.Error(
            "TripoSR finished but no 3D model (.obj / .glb / .gltf) "
            "was found in the output folder. Check the terminal logs above."
        )

    print("Returning 3D model to Gradio:", model_path)
    return model_path  # Gradio Model3D can use this path


# ---------- Gradio wrappers ----------

def remove_bg_wrapper(bg, fg):
    """
    Wrapper for the 'Remove BG & init' button.
    Returns:
      - bg_preview
      - fg_nobg_preview
      - bg_state
      - fg_state
    """
    return remove_bg_pipeline(bg, fg)


def blend_wrapper(bg_state, fg_state, x_off, y_off, scale):
    return blend_pipeline(bg_state, fg_state, x_off, y_off, scale)


def triposr_wrapper(fg_state):
    return run_triposr_on_fg(fg_state)


# ---------- Gradio app ----------

with gr.Blocks() as demo:
    gr.Markdown("# 2D Image Blending + TripoSR 3D (Gradio)")

    gr.Markdown(
        """
1. Upload a **background** image and a **foreground** image.  
2. Click **Remove BG & init** to:
   - Remove background from the foreground.
   - Prepare images for blending.  
3. Use sliders to adjust foreground position & scale.  
4. Click **Blend** to generate the final 2D image.  
5. Click **Generate 3D (TripoSR)** to create and view the 3D model.
        """
    )

    with gr.Row():
        bg_input = gr.Image(label="Background", type="pil")
        fg_input = gr.Image(label="Foreground", type="pil")

    btn_prep = gr.Button("1️⃣ Remove BG & init")

    with gr.Row():
        bg_preview = gr.Image(label="Background (for reference)", type="pil")
        fg_nobg_preview = gr.Image(label="Foreground (BG removed)", type="pil")

    # States to store processed images
    bg_state = gr.State()
    fg_state = gr.State()

    # Sliders for 2D placement
    gr.Markdown("### 2D Placement Controls (on Background)")
    x_slider = gr.Slider(-400, 400, value=0, step=5, label="X offset (px, from center)")
    y_slider = gr.Slider(-400, 400, value=0, step=5, label="Y offset (px, from center)")
    scale_slider = gr.Slider(0.1, 3.0, value=1.0, step=0.05, label="Scale factor")

    btn_blend = gr.Button("2️⃣ Blend")
    final_2d = gr.Image(label="Final 2D Blended Image", type="pil")

    gr.Markdown("### 3D Model (TripoSR)")
    btn_3d = gr.Button("3️⃣ Generate 3D (TripoSR on FG no-BG)")
    model3d = gr.Model3D(label="TripoSR 3D Model")

    # Wiring callbacks
    btn_prep.click(
        fn=remove_bg_wrapper,
        inputs=[bg_input, fg_input],
        outputs=[bg_preview, fg_nobg_preview, bg_state, fg_state],
    )

    btn_blend.click(
        fn=blend_wrapper,
        inputs=[bg_state, fg_state, x_slider, y_slider, scale_slider],
        outputs=[final_2d],
    )

    btn_3d.click(
        fn=triposr_wrapper,
        inputs=[fg_state],
        outputs=[model3d],
    )

if __name__ == "__main__":
    demo.launch()
