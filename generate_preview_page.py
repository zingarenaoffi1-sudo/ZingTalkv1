import os

files = [
    ("01_app_icon_1280x720.png", "FireTV App Icon", "1280 x 720 px (PNG, no transparency)", "Required for Fire TV tile representation on Amazon Appstore"),
    ("02_background_image_1920x1080.png", "Background Image", "1920 x 1080 px (PNG/JPG, no transparency)", "Full HD background banner behind app detail page"),
    ("03_featured_content_logo_640x260.png", "Featured Content Logo", "640 x 260 px (PNG with transparency)", "Clean typography logo for Amazon carousel"),
    ("04_featured_content_background_1920x720.png", "Featured Content Background", "1920 x 720 px (PNG/JPG, no transparency)", "Cinematic banner for Fire TV featured spotlight"),
    ("05_promotional_image_1024x500.png", "Promotional Image", "1024 x 500 px (PNG/JPG)", "Header banner for Amazon Appstore promotional listings"),
    ("06_screenshot_1_dashboard_1920x1080.png", "Screenshot 1: Dashboard & Contacts", "1920 x 1080 px (Landscape, no transparency)", "Demonstrates Fire TV Leanback D-Pad navigation & 10-Digit Quick Connect"),
    ("07_screenshot_2_videocall_1920x1080.png", "Screenshot 2: Fullscreen 1080p Video Call", "1920 x 1080 px (Landscape, no transparency)", "Showcases crystal clear WebRTC video stream & remote call controls"),
    ("08_screenshot_3_audiocall_1920x1080.png", "Screenshot 3: HD Voice Calling Visualizer", "1920 x 1080 px (Landscape, no transparency)", "Demonstrates living-room TV voice call with animated audio radar"),
    ("09_screenshot_4_chat_1920x1080.png", "Screenshot 4: TV Chat & Messaging", "1920 x 1080 px (Landscape, no transparency)", "Clean conversation view with remote keyboard and voice dictate"),
    ("10_screenshot_5_alexa_guide_1920x1080.png", "Screenshot 5: Alexa Voice Commands Guide", "1920 x 1080 px (Landscape, no transparency)", "Hands-free voice commands instructions for Amazon Fire TV review")
]

cards_html = ""
for fname, title, dims, desc in files:
    path = f"/amazon_assets/{fname}"
    cards_html += f"""
    <div class="asset-card">
        <div class="card-preview-wrapper">
            <img src="{path}" alt="{title}" loading="lazy" class="preview-img">
        </div>
        <div class="card-info">
            <div class="badge-size">{dims}</div>
            <h3 class="asset-title">{title}</h3>
            <p class="asset-desc">{desc}</p>
            <div class="action-row">
                <a href="{path}" download="{fname}" class="btn-download">⬇️ Download {fname}</a>
                <a href="{path}" target="_blank" class="btn-view">👁️ Full View</a>
            </div>
        </div>
    </div>
    """

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ZingTalk Fire TV - Official Amazon Appstore Assets</title>
    <style>
        :root {{
            --bg-dark: #080d1a;
            --bg-card: #0f172a;
            --accent: #00d2aa;
            --accent-glow: rgba(0, 210, 170, 0.3);
            --blue: #00a8e1;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --border: #1e293b;
        }}
        * {{ box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }}
        body {{ background: var(--bg-dark); color: var(--text-main); line-height: 1.5; padding: 30px 20px 80px; }}
        .header {{ max-width: 1300px; margin: 0 auto 40px; text-align: center; }}
        .header h1 {{ font-size: 38px; font-weight: 800; background: linear-gradient(135deg, #00d2aa, #00a8e1); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 10px; }}
        .header p {{ color: var(--text-muted); font-size: 16px; max-width: 700px; margin: 0 auto; }}
        .badge-bar {{ display: inline-flex; gap: 12px; margin-top: 15px; flex-wrap: wrap; justify-content: center; }}
        .badge-pill {{ background: rgba(0, 210, 170, 0.12); border: 1px solid var(--accent); color: var(--accent); padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 700; }}
        .grid {{ max-width: 1300px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 24px; }}
        .asset-card {{ background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; transition: transform 0.2s, border-color 0.2s; }}
        .asset-card:hover {{ transform: translateY(-4px); border-color: var(--accent); box-shadow: 0 10px 30px rgba(0,0,0,0.5); }}
        .card-preview-wrapper {{ background: #040711; height: 230px; display: flex; align-items: center; justify-content: center; padding: 12px; border-bottom: 1px solid var(--border); overflow: hidden; }}
        .preview-img {{ max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,0.6); }}
        .card-info {{ padding: 20px; flex: 1; display: flex; flex-direction: column; }}
        .badge-size {{ display: inline-block; background: rgba(0, 168, 225, 0.15); border: 1px solid rgba(0, 168, 225, 0.4); color: var(--blue); font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 6px; margin-bottom: 10px; width: fit-content; }}
        .asset-title {{ font-size: 19px; font-weight: 700; color: #fff; margin-bottom: 6px; }}
        .asset-desc {{ color: var(--text-muted); font-size: 13.5px; margin-bottom: 18px; flex: 1; }}
        .action-row {{ display: flex; gap: 10px; }}
        .btn-download {{ flex: 1; background: var(--accent); color: #070d18; text-decoration: none; padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 800; text-align: center; transition: opacity 0.2s; }}
        .btn-download:hover {{ opacity: 0.9; }}
        .btn-view {{ background: #1e293b; color: #fff; text-decoration: none; padding: 10px 14px; border-radius: 8px; font-size: 13px; font-weight: 700; text-align: center; }}
        .btn-view:hover {{ background: #334155; }}
    </style>
</head>
<body>
    <div class="header">
        <h1>Official Amazon Appstore Assets for Fire TV</h1>
        <p>All screenshots, icons, and promotional graphics formatted to 100% exact Amazon Appstore pixel requirements without transparency errors.</p>
        <div class="badge-bar">
            <span class="badge-pill">✓ Exact 1920x1080 Screenshots (No Transparency)</span>
            <span class="badge-pill">✓ 1280x720 App Icon</span>
            <span class="badge-pill">✓ 1920x1080 Background</span>
            <span class="badge-pill">✓ 640x260 Featured Logo</span>
            <span class="badge-pill">✓ 1024x500 Promo Image</span>
        </div>
    </div>
    <div class="grid">
        {cards_html}
    </div>
</body>
</html>
"""

with open("public/amazon-assets.html", "w") as f:
    f.write(html)

print("Created public/amazon-assets.html successfully!")
