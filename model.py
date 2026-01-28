from diffusers import StableDiffusionXLPipeline

print("Downloading SSD-1B model...")
pipe = StableDiffusionXLPipeline.from_pretrained(
    "segmind/SSD-1B",
)

print("Done!")
