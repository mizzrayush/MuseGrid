import os
import subprocess
from PIL import Image, ImageDraw

def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    scripts_dir = os.path.join(base_dir, "scripts")
    html_file = os.path.join(scripts_dir, "render_icon.html")
    png_1024 = os.path.join(scripts_dir, "raw_icon_1024.png")

    svg_content = """<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="mg-logo-bg" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1e202e" />
      <stop offset="100%" stop-color="#101118" />
    </linearGradient>
    <linearGradient id="mg-bar-grad1" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#00e6ff" />
      <stop offset="100%" stop-color="#0077ff" />
    </linearGradient>
    <linearGradient id="mg-bar-grad2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ff3366" />
      <stop offset="100%" stop-color="#ff6b3b" />
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="20" height="20" rx="5" fill="url(#mg-logo-bg)" stroke="rgba(255,255,255,0.15)" stroke-width="0.8" />
  <rect x="5.5" y="10" width="2.5" height="8" rx="1.25" fill="url(#mg-bar-grad1)" />
  <rect x="9.5" y="5.5" width="2.5" height="12.5" rx="1.25" fill="url(#mg-bar-grad1)" />
  <rect x="13.5" y="8" width="2.5" height="10" rx="1.25" fill="url(#mg-bar-grad2)" />
  <rect x="17.5" y="12" width="2.5" height="6" rx="1.25" fill="url(#mg-bar-grad2)" />
  <circle cx="6.75" cy="6.5" r="1.2" fill="#00e6ff" opacity="0.9" />
  <circle cx="18.75" cy="8.5" r="1.2" fill="#ff3366" opacity="0.9" />
</svg>"""

    # Also write clean standalone SVG for favicon.svg
    public_favicon = os.path.join(base_dir, "public", "favicon.svg")
    with open(public_favicon, "w", encoding="utf-8") as f:
        f.write(svg_content)

    html_content = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * {{ box-sizing: border-box; }}
  html, body {{
    margin: 0;
    padding: 0;
    width: 1024px;
    height: 1024px;
    overflow: hidden;
    background: transparent;
  }}
  svg {{
    width: 1024px;
    height: 1024px;
    display: block;
  }}
</style>
</head>
<body>
{svg_content}
</body>
</html>"""

    with open(html_file, "w", encoding="utf-8") as f:
        f.write(html_content)

    edge_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    cmd = [
        edge_path,
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        f"--screenshot={png_1024}",
        "--window-size=1024,1024",
        html_file
    ]
    print(f"Rendering SVG via Edge: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)

    # Now open in PIL and apply high quality antialiased alpha mask for rounded corners
    raw_img = Image.open(png_1024).convert("RGBA")
    W, H = raw_img.size

    # Super-sampled mask at 2x
    mask_scale = 2
    mw, mh = W * mask_scale, H * mask_scale
    mask_large = Image.new("L", (mw, mh), 0)
    d = ImageDraw.Draw(mask_large)
    
    # SVG viewBox: 0..24
    # rect is x=2, y=2, w=20, h=20, rx=5
    unit = mw / 24.0
    x0 = 2.0 * unit
    y0 = 2.0 * unit
    x1 = 22.0 * unit
    y1 = 22.0 * unit
    radius = 5.0 * unit
    d.rounded_rectangle([x0, y0, x1, y1], radius=radius, fill=255)

    mask = mask_large.resize((W, H), Image.Resampling.LANCZOS)
    raw_img.putalpha(mask)

    # Save 1024x1024 master
    master_png = os.path.join(scripts_dir, "master_icon_1024.png")
    raw_img.save(master_png, "PNG")

    # Generate public/icon.png (512x512)
    p_icon_png = os.path.join(base_dir, "public", "icon.png")
    img_512 = raw_img.resize((512, 512), Image.Resampling.LANCZOS)
    img_512.save(p_icon_png, "PNG")

    # Generate build/icons folder
    icons_dir = os.path.join(base_dir, "build", "icons")
    os.makedirs(icons_dir, exist_ok=True)
    sizes = [1024, 512, 256, 128, 64, 48, 32, 24, 16]
    for s in sizes:
        s_img = raw_img.resize((s, s), Image.Resampling.LANCZOS)
        s_img.save(os.path.join(icons_dir, f"{s}x{s}.png"), "PNG")

    # Generate multi-size ICO
    ico_destinations = [
        os.path.join(base_dir, "icon.ico"),
        os.path.join(base_dir, "bin", "icon.ico"),
        os.path.join(base_dir, "native", "Source", "Resources", "icon.ico"),
        os.path.join(base_dir, "public", "icon.ico"),
        os.path.join(icons_dir, "icon.ico"),
    ]

    ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    # Save the ICO file
    for dest in ico_destinations:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        raw_img.save(dest, format="ICO", sizes=ico_sizes)
        print(f"Generated new icon: {dest}")

    print("Icon generation completed successfully!")

if __name__ == "__main__":
    main()
