// ========== 2D: Fabric canvas ==========
let canvas = new fabric.Canvas("c");

let fgObj = null;
let currentBgUrl = null;
let currentFgUrl = null;
let lastBlendedURL = "";
let lastModelURL = "";
let lastTextureURL = "";

// Reset 2D + 3D state
function resetCanvas() {
  canvas.clear();
  canvas.setBackgroundImage(null, canvas.renderAll.bind(canvas));
  fgObj = null;
  currentBgUrl = null;
  currentFgUrl = null;
  lastBlendedURL = "";
  lastModelURL = "";
  lastTextureURL = "";

  const finalImg = document.getElementById("final-img");
  finalImg.style.display = "none";
  finalImg.removeAttribute("src");
}

// Upload images to backend
function uploadImages() {
  const bgFile = document.getElementById("img1").files[0];
  const fgSource = document.querySelector('input[name="fg_source"]:checked').value;

  if (!bgFile) {
    alert("Please choose a background image.");
    return;
  }

  // If user chose file-based foreground -> behave like before
  if (fgSource === "file") {
    const fgFile = document.getElementById("img2").files[0];
    if (!fgFile) {
      alert("Please choose a foreground file (or switch to prompt option).");
      return;
    }

    const form = new FormData();
    form.append("image1", bgFile);
    form.append("image2", fgFile);

    fetch("/upload", { method: "POST", body: form })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          alert("Upload error: " + data.error);
          console.error("Upload error:", data.error);
          return;
        }

        currentBgUrl = data.image1;
        currentFgUrl = data.image2_nobg;
        lastBlendedURL = "";
        lastModelURL = "";
        lastTextureURL = "";

        const finalImg = document.getElementById("final-img");
        finalImg.style.display = "none";
        finalImg.removeAttribute("src");

        loadEditor(currentBgUrl, currentFgUrl);
      })
      .catch((err) => {
        console.error("Upload failed:", err);
        alert("Upload failed. See console.");
      });

    return;
  }

  // If user chose prompt-based foreground -> upload background first and request generation
  // If user chose prompt-based: generate foreground locally
  if (fgSource === "prompt") {

    if (!bgFile) {
        alert("Please choose a background image.");
        return;
    }

    // First upload background using the normal /upload trick
    const form = new FormData();
    form.append("image1", bgFile);
    form.append("image2", bgFile); // dummy second file

    fetch("/upload", { method: "POST", body: form })
      .then(res => res.json())
      .then(data => {
          if (data.error) { alert(data.error); return; }

          currentBgUrl = data.image1;

          const promptInput = document.getElementById("fgPrompt").value.trim();
          const keepShadow = document.getElementById("fgShadowChoice").value;

          if (!promptInput) {
              alert("Enter a prompt first.");
              return;
          }

          const f2 = new FormData();
          f2.append("prompt", promptInput);
          f2.append("keep_shadows", keepShadow);

          return fetch("/prompt_fg", { method:"POST", body:f2 });
      })
      .then(r => r.json())
      .then(data => {
          if (data.error) {
              alert("Local generation error: " + data.error);
              return;
          }
          currentFgUrl = data.fg;
          loadEditor(currentBgUrl, currentFgUrl);
      })
      .catch(err => console.error(err));

    return;
  }


  alert("Unknown foreground source selection.");
}

// Load images into Fabric canvas
function loadEditor(bgUrl, fgUrl) {
  canvas.clear();
  fgObj = null;

  const W = canvas.getWidth();
  const H = canvas.getHeight();

  fabric.Image.fromURL(
    bgUrl,
    function (bgImg) {
      const scale = Math.min(W / bgImg.width, H / bgImg.height);
      canvas.setBackgroundImage(
        bgImg,
        canvas.renderAll.bind(canvas),
        {
          originX: "center",
          originY: "center",
          left: W / 2,
          top: H / 2,
          scaleX: scale,
          scaleY: scale,
        }
      );

      fabric.Image.fromURL(
        fgUrl,
        function (img) {
          fgObj = img;

          const maxW = W * 0.4;
          const maxH = H * 0.4;
          const s = Math.min(maxW / img.width, maxH / img.height, 1);
          img.scale(s);

          img.set({
            left: W / 2,
            top: H / 2,
            originX: "center",
            originY: "center",
            hasBorders: true,
            hasControls: true,
          });

          canvas.add(img);
          canvas.setActiveObject(img);
          img.setCoords();
          canvas.renderAll();
        },
        { crossOrigin: "anonymous" }
      );
    },
    { crossOrigin: "anonymous" }
  );
}

// Blend current composition
function blendOnly() {
  if (!fgObj || !currentBgUrl || !currentFgUrl) {
    alert("Please upload images first.");
    return;
  }

  const W = canvas.getWidth();
  const H = canvas.getHeight();

  const w = fgObj.getScaledWidth();
  const h = fgObj.getScaledHeight();
  const x = fgObj.left - w / 2;
  const y = fgObj.top - h / 2;

  const form = new FormData();
  form.append("bg", currentBgUrl);
  form.append("fg", currentFgUrl);
  form.append("x", Math.round(x));
  form.append("y", Math.round(y));
  form.append("w", Math.round(w));
  form.append("h", Math.round(h));
  form.append("canvas_w", Math.round(W));
  form.append("canvas_h", Math.round(H));

  fetch("/blend", { method: "POST", body: form })
    .then((res) => res.json())
    .then((data) => {
      if (data.error) {
        alert("Blend error: " + data.error);
        console.error("Blend error:", data.error);
        return;
      }

      lastBlendedURL = data.final;

      const finalImg = document.getElementById("final-img");
      finalImg.src = data.final;
      finalImg.style.display = "block";
    })
    .catch((err) => {
      console.error("Blend failed:", err);
      alert("Blend failed. See console.");
    });
}

// Download final blended image
function downloadFinal() {
  if (!lastBlendedURL) {
    alert("Please click Blend first.");
    return;
  }

  const a = document.createElement("a");
  a.href = lastBlendedURL;
  a.download = "blended_image.png";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ========== 3D viewer (three.js) ==========
/* (rest of your existing 3D viewer code remains unchanged)
   For brevity I keep the rest of your existing functions below unchanged:
   initViewer3D, clear3DViewer, load3DModel, generate3DAndUse, capture3DToForeground,
   place3DModelInCanvas, Custom3DObject, captureThenBlend, etc.
   (they remain exactly as in your previous file)
*/

// ---------- keep the original 3D / captureThenBlend code below ----------
let viewerScene = null;
let viewerCamera = null;
let viewerRenderer = null;
let viewerControls = null;
let viewerObject = null;
let viewerReady = false;

function initViewer3D() {
  if (viewerReady) return;

  const container = document.getElementById("viewer3d");
  if (!container) return;

  const width = container.clientWidth || 400;
  const height = container.clientHeight || 300;

  // Make scene background null (transparent)
  viewerScene = new THREE.Scene();
  viewerScene.background = null; // <- remove solid color

  viewerCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  viewerCamera.position.set(0, 1, 3);

  // Create renderer with alpha: true so the canvas is transparent
  viewerRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  // ensure clear alpha is 0 (fully transparent)
  viewerRenderer.setClearColor(0x000000, 0);
  viewerRenderer.setSize(width, height);
  container.innerHTML = "";
  container.appendChild(viewerRenderer.domElement);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
  viewerScene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 10, 7);
  viewerScene.add(dir);

  viewerControls = new THREE.OrbitControls(
    viewerCamera,
    viewerRenderer.domElement
  );
  viewerControls.enableDamping = true;
  viewerControls.dampingFactor = 0.1;

  viewerReady = true;

  function animate() {
    requestAnimationFrame(animate);
    if (viewerControls) viewerControls.update();
    if (viewerRenderer && viewerScene && viewerCamera) {
      viewerRenderer.render(viewerScene, viewerCamera);
    }
  }

  animate();
}

function clear3DViewer() {
  if (!viewerScene || !viewerObject) return;
  viewerScene.remove(viewerObject);
  viewerObject = null;
  if (viewerRenderer && viewerCamera) {
    viewerRenderer.render(viewerScene, viewerCamera);
  }
}

function load3DModel(modelUrl, textureUrl) {
  initViewer3D();
  if (!viewerScene) return;

  clear3DViewer();

  const loader = new THREE.OBJLoader();
  loader.load(
    modelUrl,
    function (obj) {
      viewerObject = obj;

      // Basic grey material first
      obj.traverse((child) => {
        if (child.isMesh) {
          child.material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.1,
            roughness: 0.9,
          });
        }
      });

      // Center and frame
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      obj.position.sub(center);
      viewerScene.add(obj);

      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const fov = (viewerCamera.fov * Math.PI) / 180;
      let cameraZ = maxDim / (2 * Math.tan(fov / 2));
      cameraZ *= 2;
      viewerCamera.position.set(0, maxDim * 0.5, cameraZ);
      viewerCamera.lookAt(0, 0, 0);

      if (viewerControls) {
        viewerControls.target.set(0, 0, 0);
        viewerControls.update();
      }

      viewerRenderer.render(viewerScene, viewerCamera);

      // If we have a texture, apply it
      if (textureUrl) {
        const texLoader = new THREE.TextureLoader();
        texLoader.load(
          textureUrl,
          function (tex) {
            tex.flipY = false; // often needed for OBJ UVs
            obj.traverse((child) => {
              if (child.isMesh && child.material) {
                child.material.map = tex;
                child.material.needsUpdate = true;
              }
            });
          },
          undefined,
          function (err) {
            console.warn("Failed to load texture:", err);
          }
        );
      }
    },
    undefined,
    function (err) {
      console.error("Error loading 3D model:", err);
      alert("Error loading 3D model. See console.");
    }
  );
}

function generate3DAndUse() {
  if (!currentFgUrl) {
    alert("Please upload images first.");
    return;
  }

  const form = new FormData();
  form.append("fg", currentFgUrl);

  fetch("/triposr", { method: "POST", body: form })
    .then((res) => res.json())
    .then((data) => {
      if (data.error) {
        alert("TripoSR error: " + data.error);
        console.error("TripoSR error:", data.error);
        return;
      }

      lastModelURL = data.model || "";
      lastTextureURL = data.texture || "";

      const modelBlock = document.getElementById("model-block");
      const modelLink = document.getElementById("model-link");

      if (lastModelURL) {
        modelBlock.style.display = "block";
        modelLink.href = lastModelURL;
        load3DModel(lastModelURL, lastTextureURL);
      } else {
        modelBlock.style.display = "none";
      }

      if (data.render) {
        currentFgUrl = data.render;
        loadEditor(currentBgUrl || data.render, currentFgUrl);
      } else {
        alert("3D model created, but no render image found.");
      }
    })
    .catch((err) => {
      console.error("TripoSR request failed:", err);
      alert("TripoSR request failed. See console.");
    });
}

function capture3DToForeground() {
  if (!viewerRenderer) {
    alert("No 3D view yet. Click Generate 3D first.");
    return;
  }

  let dataURL;
  try {
    dataURL = window.fabric3DRenderer.domElement.toDataURL()
  } catch (e) {
    console.error("Capture 3D failed:", e);
    alert("Your browser blocked 3D capture.");
    return;
  }

  const form = new FormData();
  form.append("image_data", dataURL);

  fetch("/upload_3d_view", { method: "POST", body: form })
    .then((res) => res.json())
    .then((data) => {
      if (data.error) {
        alert("Upload 3D view error: " + data.error);
        console.error("Upload 3D view error:", data.error);
        return;
      }

      currentFgUrl = data.fg;
      loadEditor(currentBgUrl || currentFgUrl, currentFgUrl);
    })
    .catch((err) => {
      console.error("Upload 3D view failed:", err);
      alert("Upload 3D view failed. See console.");
    });
}

// =====================================================
// PLACE ROTATABLE 3D IN FABRIC CANVAS
// =====================================================
function place3DModelInCanvas() {
  if (!lastModelURL) {
    alert("Generate 3D first.");
    return;
  }

  // ---- Remove OLD 2D chair from Fabric canvas ----
  if (fgObj) {
    canvas.remove(fgObj);
    fgObj = null;
    currentFgUrl = null;
  }

  const wrapper = document.getElementById("canvas-wrapper");

  // Remove old embedded viewer
  let old = document.getElementById("threeCanvasInFabric");
  if (old) old.remove();

  // Create overlay for 3D viewer
  const overlay = document.createElement("div");
  overlay.id = "threeCanvasInFabric";
  overlay.style.position = "absolute";
  // place it at default center; fabric will control final position
  overlay.style.left = "150px";
  overlay.style.top = "150px";
  overlay.style.width = "300px";
  overlay.style.height = "300px";
  overlay.style.background = "transparent";
  overlay.style.pointerEvents = "auto";
  overlay.style.zIndex = 20;

  wrapper.appendChild(overlay);

  // ---------------- THREE.JS INSIDE --------------------
  const width = overlay.clientWidth || 300;
  const height = overlay.clientHeight || 300;

  const scene = new THREE.Scene();
  scene.background = null; // transparent background

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  camera.position.set(0, 1, 3);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true, // allows transparency
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setClearColor(0x000000, 0); // fully transparent

  // expose renderer/scene/camera globally so capture uses the right instance
  window.fabric3DRenderer = renderer;
  window.fabric3DScene = scene;
  window.fabric3DCamera = camera;

  overlay.appendChild(renderer.domElement);

  // Lighting - balanced for PBR
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(5, 10, 7);
  dir.castShadow = false;
  scene.add(dir);

  // Orbit controls
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;

  // Keep a reference so other code can pause/resume if needed
  window.fabric3DControls = controls;

  // Load the 3D model
  const loader = new THREE.OBJLoader();
  loader.load(
    lastModelURL,
    (obj) => {
      // Use MeshStandardMaterial so lighting works; set DoubleSide to avoid black faces
      obj.traverse((child) => {
        if (child.isMesh) {
          child.material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.0,
            roughness: 0.9,
            side: THREE.DoubleSide,
            map: null,
          });
          // ensure geometry has vertex normals
          if (!child.geometry.attributes.normal) {
            child.geometry.computeVertexNormals();
          }
        }
      });

      // Apply texture if present
      if (lastTextureURL) {
        const texLoader = new THREE.TextureLoader();
        texLoader.load(
          lastTextureURL,
          (tex) => {
            tex.flipY = false;
            if (tex.encoding) tex.encoding = THREE.sRGBEncoding;
            obj.traverse((child) => {
              if (child.isMesh && child.material) {
                child.material.map = tex;
                child.material.needsUpdate = true;
              }
            });
          },
          undefined,
          (err) => {
            console.warn("Texture load failed:", err);
          }
        );
      }

      // Center & scale object
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = box.getCenter(new THREE.Vector3());

      // Move to origin
      obj.position.sub(center);

      // If very large/small, scale to fit overlay
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const desired = 1.0; // generic target size
      const scaleFactor = desired / maxDim;
      obj.scale.setScalar(scaleFactor);

      scene.add(obj);

      // Save reference for potential later use
      window.fabric3DObject = obj;
    },
    undefined,
    function (err) {
      console.error("Error loading 3D model:", err);
      alert("Error loading 3D model. See console.");
    }
  );

  // --------- Add as Fabric Movable Object -----------

  // Custom3DObject will sync the overlay's style (left,top,transform) with Fabric transforms.
  const fabric3D = new Custom3DObject(overlay, {
    left: 150,
    top: 150,
    originX: "left",
    originY: "top",
  });

  // make sure Fabric renders above background
  canvas.add(fabric3D);
  canvas.setActiveObject(fabric3D);
  fabric3D.setCoords();
  canvas.renderAll();

  // Animation loop (keeps renderer drawing)
  function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();
    if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }
  }
  // Start render loop once (safe to call even if object not yet loaded)
  animate();
}

class Custom3DObject extends fabric.Group {
  constructor(element, options = {}) {
    super(
      [],
      {
        ...options,
        selectable: true,
        hasControls: true,
        hasBorders: true,
      }
    );

    this.htmlElement = element;
    this.width = element.offsetWidth;
    this.height = element.offsetHeight;

    // initialize transform state
    this._lastTransform = { left: this.left || 0, top: this.top || 0, scaleX: 1, scaleY: 1, angle: 0 };

    this.on("moving", () => this.syncToHtml());
    this.on("scaling", () => this.syncToHtml());
    this.on("rotating", () => this.syncToHtml());
    this.on("modified", () => this.syncToHtml());
  }

  syncToHtml() {
    // Update position (use left/top)
    const left = this.left || 0;
    const top = this.top || 0;

    // Fabric scale/rotation values
    const scaleX = this.scaleX || 1;
    const scaleY = this.scaleY || 1;
    const angle = this.angle || 0;

    // set absolute position (relative to canvas wrapper)
    this.htmlElement.style.left = `${Math.round(left)}px`;
    this.htmlElement.style.top = `${Math.round(top)}px`;

    // combine rotation + scale into single transform - preserve translate performed by left/top
    // note: we don't set translate in transform because we already use left/top for that
    this.htmlElement.style.transformOrigin = "top left";
    this.htmlElement.style.transform = `rotate(${angle}deg) scale(${scaleX}, ${scaleY})`;
  }

  _render(ctx) {
    // Nothing to draw in Fabric's canvas for this group; HTML overlay renders itself.
    // Keep this empty so Fabric doesn't try to rasterize the overlay.
  }
}

function captureThenBlend() {
  const overlay = document.getElementById("threeCanvasInFabric");

  // If no 3D overlay → normal blendOnly()
  if (!overlay || !window.fabric3DRenderer) {
    // fallback to normal blend if no 3D overlay present
    blendOnly();
    return;
  }

  // Ensure renderer is ready and has content
  if (!window.fabric3DRenderer.domElement) {
    alert("3D renderer not ready.");
    return;
  }

  // --- 1. Capture 3D canvas (use the exact renderer appended to overlay) ---
  let dataURL;
  try {
    // Ensure the renderer has just rendered a frame (use existing global camera/scene)
    // We attempt a final render to ensure latest frame is captured:
    try {
      if (window.fabric3DRenderer && window.fabric3DScene && window.fabric3DCamera) {
        window.fabric3DRenderer.render(window.fabric3DScene, window.fabric3DCamera);
      }
    } catch (e) {
      // ignore render errors; we'll still attempt to capture
      console.warn("Final render before capture failed:", e);
    }
    dataURL = window.fabric3DRenderer.domElement.toDataURL("image/png");
  } catch (e) {
    console.error("Capture 3D failed:", e);
    alert("Your browser blocked 3D capture.");
    return;
  }

  // --- 2. Upload PNG to backend ---
  const form = new FormData();
  form.append("image_data", dataURL);

  fetch("/upload_3d_view", { method: "POST", body: form })
    .then((r) => r.json())
    .then((data) => {
      if (data.error) {
        alert("Upload 3D view error: " + data.error);
        throw new Error(data.error || "upload_3d_view failed");
      }

      const fgURL = data.fg;

      // --- 3. Convert overlay div position to Fabric coordinates (respect zoom / viewport) ---
      const canvasRect = canvas.upperCanvasEl.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();

      // screen coords relative to canvas top-left:
      let xScreen = overlayRect.left - canvasRect.left;
      let yScreen = overlayRect.top - canvasRect.top;

      // Fabric viewport transform and zoom
      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const zoom = canvas.getZoom ? canvas.getZoom() : vpt[0] || 1;

      // Convert screen -> canvas coordinate space used by /blend (these should match the canvas coordinate system)
      const xCanvas = (xScreen - vpt[4]) / zoom;
      const yCanvas = (yScreen - vpt[5]) / zoom;

      // width/height in canvas coordinates
      const wCanvas = overlayRect.width / zoom;
      const hCanvas = overlayRect.height / zoom;

      // Remove overlay from HTML (so final capture doesn't include it)
      // Instead of removing, temporarily hide it
      overlay.style.visibility = "hidden";

      // --- 4. Send correct values directly to /blend ---
      const W = canvas.getWidth();
      const H = canvas.getHeight();

      const form2 = new FormData();
      form2.append("bg", currentBgUrl);
      form2.append("fg", fgURL);
      form2.append("x", Math.round(xCanvas));
      form2.append("y", Math.round(yCanvas));
      form2.append("w", Math.round(wCanvas));
      form2.append("h", Math.round(hCanvas));
      form2.append("canvas_w", Math.round(W));
      form2.append("canvas_h", Math.round(H));

      return fetch("/blend", { method: "POST", body: form2 });
    })
    .then((r) => r.json())
    .then((result) => {
      if (!result) return;
      if (result.error) {
        alert(result.error);
        return;
      }
      const overlay = document.getElementById("threeCanvasInFabric");
      if (overlay) overlay.style.visibility = "visible";
      // Show final result
      const finalImg = document.getElementById("final-img");
      finalImg.src = result.final;
      finalImg.style.display = "block";
    })
    .catch((err) => {
      console.error("captureThenBlend failed:", err);
    });
}
