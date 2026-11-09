import subprocess
import os

os.makedirs("amazon_submission_assets", exist_ok=True)
os.makedirs("public/amazon_assets", exist_ok=True)

def run(cmd):
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if p.returncode != 0:
        print("ERR:", cmd)
        print(p.stderr)
    return p.returncode == 0

print("1. Creating App Icon (1280x720 PNG, no transparency)...")
# Dark modern navy blue-black gradient with ZingTalk neon cyan/emerald glowing emblem in center
run("""
convert -size 1280x720 gradient:'#070d18'-'#0f172a' \\
  \\( assets/icon.png -resize 440x440 \\( +clone -background '#00d2aa' -shadow 80x25+0+0 \\) +swap -background none -flatten \\) \\
  -gravity center -composite \\
  \\( -background none -fill white -font DejaVu-Sans-Bold -pointsize 54 label:"ZingTalk TV" \\) \\
  -gravity south -geometry +0+60 -composite \\
  -alpha off amazon_submission_assets/01_app_icon_1280x720.png
""")

print("2. Creating Background Image (1920x1080 PNG/JPG, no transparency)...")
run("""
convert -size 1920x1080 gradient:'#050811'-'#0e192d' \\
  \\( -size 1920x1080 radial-gradient:transparent-'rgba(0,0,0,0.6)' \\) -composite \\
  \\( assets/icon.png -resize 260x260 \\( +clone -background '#00d2aa' -shadow 70x30+0+0 \\) +swap -background none -flatten \\) \\
  -gravity center -geometry +0-120 -composite \\
  \\( -background none -fill '#ffffff' -font DejaVu-Sans-Bold -pointsize 76 label:"ZingTalk TV" \\) \\
  -gravity center -geometry +0+80 -composite \\
  \\( -background none -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 32 label:"Real-Time HD Video & Voice Calling on Amazon Fire TV" \\) \\
  -gravity center -geometry +0+160 -composite \\
  \\( -background none -fill '#94a3b8' -font DejaVu-Sans -pointsize 24 label:"With Alexa Voice Integration • 10-Digit Instant UID • Zero Server Storage" \\) \\
  -gravity center -geometry +0+220 -composite \\
  -alpha off amazon_submission_assets/02_background_image_1920x1080.png
""")

print("3. Creating Featured Content Logo (640x260 PNG, transparency optional)...")
run("""
convert -size 640x260 xc:none \\
  \\( assets/icon.png -resize 140x140 \\( +clone -background '#00d2aa' -shadow 70x15+0+0 \\) +swap -background none -flatten \\) \\
  -gravity west -geometry +40+0 -composite \\
  \\( -background none -fill white -font DejaVu-Sans-Bold -pointsize 48 label:"ZingTalk TV" \\) \\
  -gravity center -geometry +60-20 -composite \\
  \\( -background none -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 20 label:"HD VIDEO CALLS & CHAT" \\) \\
  -gravity center -geometry +60+30 -composite \\
  amazon_submission_assets/03_featured_content_logo_640x260.png
""")

print("4. Creating Featured Content Background (1920x720 PNG/JPG, no transparency)...")
run("""
convert -size 1920x720 gradient:'#070d1a'-'#111e38' \\
  \\( assets/icon.png -resize 320x320 \\( +clone -background '#00d2aa' -shadow 70x30+0+0 \\) +swap -background none -flatten \\) \\
  -gravity west -geometry +120+0 -composite \\
  \\( -background none -fill white -font DejaVu-Sans-Bold -pointsize 68 label:"ZingTalk TV" \\) \\
  -gravity west -geometry +500-60 -composite \\
  \\( -background none -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 30 label:"Amazon Fire TV Leanback Calling & Remote Control" \\) \\
  -gravity west -geometry +500+10 -composite \\
  \\( -background none -fill '#94a3b8' -font DejaVu-Sans -pointsize 24 label:"Connect instantly with Family on the big screen with 10-Digit UID" \\) \\
  -gravity west -geometry +500+70 -composite \\
  -alpha off amazon_submission_assets/04_featured_content_background_1920x720.png
""")

print("5. Creating Promotional Image (1024x500 PNG/JPG)...")
run("""
convert -size 1024x500 gradient:'#060a14'-'#101b30' \\
  \\( assets/icon.png -resize 200x200 \\( +clone -background '#00d2aa' -shadow 75x20+0+0 \\) +swap -background none -flatten \\) \\
  -gravity west -geometry +70+0 -composite \\
  \\( -background none -fill white -font DejaVu-Sans-Bold -pointsize 52 label:"ZingTalk TV" \\) \\
  -gravity west -geometry +310-50 -composite \\
  \\( -background none -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 22 label:"HD VIDEO & VOICE CALLS ON FIRE TV" \\) \\
  -gravity west -geometry +310+10 -composite \\
  \\( -background none -fill '#94a3b8' -font DejaVu-Sans -pointsize 18 label:"Alexa Voice Hands-Free • Direct 10-Digit Calling • Senior Friendly" \\) \\
  -gravity west -geometry +310+60 -composite \\
  -alpha off amazon_submission_assets/05_promotional_image_1024x500.png
""")

print("6. Creating Screenshot 1 (1920x1080): Dashboard & Quick Connect with Leanback UI...")
# Dashboard screen showing Quick Connect, Saved Contacts, and TV Navigation
run("""
convert -size 1920x1080 xc:'#070c14' \\
  \\( -size 1920x90 xc:'#0a1220' -fill '#182336' -draw "line 0,89 1920,89" \\
      \\( assets/icon.png -resize 50x50 \\) -gravity west -geometry +40+0 -composite \\
      \\( -background none -fill white -font DejaVu-Sans-Bold -pointsize 28 label:"ZingTalk TV" \\) -gravity west -geometry +105+0 -composite \\
      \\( -size 240x44 xc:'#00a8e133' -stroke '#00a8e1' -strokewidth 1 -fill none -draw "roundrectangle 0,0 239,43 8,8" \\
          -stroke none -fill '#00d2ff' -font DejaVu-Sans-Bold -pointsize 16 -gravity center -annotate +0+0 "🎙️ Alexa Voice Active" \\) \\
          -gravity east -geometry +560+0 -composite \\
      \\( -size 200x44 xc:'#00d29d22' -stroke '#00d29d' -strokewidth 1 -fill none -draw "roundrectangle 0,0 199,43 8,8" \\
          -stroke none -fill '#00d29d' -font DejaVu-Sans-Bold -pointsize 16 -gravity center -annotate +0+0 "● AWS Cloud Online" \\) \\
          -gravity east -geometry +330+0 -composite \\
      \\( -size 270x52 xc:'#151f32' -stroke '#22324e' -strokewidth 1 -fill none -draw "roundrectangle 0,0 269,51 26,26" \\
          -stroke none -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 22 -gravity west -annotate +15+0 "A" \\
          -fill white -font DejaVu-Sans-Bold -pointsize 17 -gravity west -annotate +50-8 "Amit FireTV" \\
          -fill '#00d29d' -font DejaVu-Sans -pointsize 13 -gravity west -annotate +50+12 "UID: 2943612054" \\) \\
          -gravity east -geometry +40+0 -composite \\
  \\) -gravity north -composite \\
  \\( -size 520x920 xc:'#0c1424' -stroke '#1e2c45' -strokewidth 1 -fill none -draw "roundrectangle 0,0 519,919 16,16" \\
      -stroke none -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 13 -gravity northwest -annotate +30+30 "QUICK CONNECT" \\
      -fill white -font DejaVu-Sans-Bold -pointsize 20 -gravity northwest -annotate +30+55 "Enter 10-Digit UID" \\
      \\( -size 460x60 xc:'#131d31' -stroke '#00d2aa' -strokewidth 2 -fill none -draw "roundrectangle 0,0 459,59 10,10" \\
          -stroke none -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 26 -gravity center -annotate +0+0 "1065736144" \\) \\
          -gravity northwest -geometry +30+100 -composite \\
      \\( -size 140x52 xc:'#00d2aa' -draw "roundrectangle 0,0 139,51 10,10" \\
          -fill '#070c14' -font DejaVu-Sans-Bold -pointsize 16 -gravity center -annotate +0+0 "💬 Chat" \\) \\
          -gravity northwest -geometry +30+180 -composite \\
      \\( -size 140x52 xc:'#16233a' -stroke '#2a3b5c' -strokewidth 1 -fill none -draw "roundrectangle 0,0 139,51 10,10" \\
          -stroke none -fill white -font DejaVu-Sans-Bold -pointsize 16 -gravity center -annotate +0+0 "📞 Audio" \\) \\
          -gravity northwest -geometry +190+180 -composite \\
      \\( -size 140x52 xc:'#16233a' -stroke '#2a3b5c' -strokewidth 1 -fill none -draw "roundrectangle 0,0 139,51 10,10" \\
          -stroke none -fill white -font DejaVu-Sans-Bold -pointsize 16 -gravity center -annotate +0+0 "🎥 Video" \\) \\
          -gravity northwest -geometry +350+180 -composite \\
      -stroke none -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 13 -gravity northwest -annotate +30+265 "SAVED CONTACTS" \\
      \\( -size 460x88 xc:'#111b2d' -stroke '#00d2aa' -strokewidth 2 -fill none -draw "roundrectangle 0,0 459,87 12,12" \\
          -stroke none -fill '#00d2aa' -draw "circle 45,44 45,20" \\
          -fill '#070c14' -font DejaVu-Sans-Bold -pointsize 22 -gravity west -annotate +35+0 "R" \\
          -fill white -font DejaVu-Sans-Bold -pointsize 19 -gravity west -annotate +85-12 "Rahul Sharma" \\
          -fill '#94a3b8' -font DejaVu-Sans -pointsize 14 -gravity west -annotate +85+14 "UID: 1065736144 • Online" \\
          \\( -size 46x46 xc:'#00a8e133' -stroke '#00a8e1' -strokewidth 1 -fill none -draw "roundrectangle 0,0 45,45 8,8" \\
              -stroke none -fill '#00d2ff' -font DejaVu-Sans -pointsize 20 -gravity center -annotate +0+0 "📞" \\) \\
              -gravity east -geometry +65+0 -composite \\
          \\( -size 46x46 xc:'#00d2aa33' -stroke '#00d2aa' -strokewidth 1 -fill none -draw "roundrectangle 0,0 45,45 8,8" \\
              -stroke none -fill '#00d2aa' -font DejaVu-Sans -pointsize 20 -gravity center -annotate +0+0 "🎥" \\) \\
              -gravity east -geometry +12+0 -composite \\
      \\) -gravity northwest -geometry +30+300 -composite \\
      \\( -size 460x88 xc:'#111b2d' -stroke '#1e2c45' -strokewidth 1 -fill none -draw "roundrectangle 0,0 459,87 12,12" \\
          -stroke none -fill '#a855f7' -draw "circle 45,44 45,20" \\
          -fill white -font DejaVu-Sans-Bold -pointsize 22 -gravity west -annotate +35+0 "P" \\
          -fill white -font DejaVu-Sans-Bold -pointsize 19 -gravity west -annotate +85-12 "Priya Patel" \\
          -fill '#94a3b8' -font DejaVu-Sans -pointsize 14 -gravity west -annotate +85+14 "UID: 8375257309 • Mobile" \\
          \\( -size 46x46 xc:'#16233a' -stroke '#2a3b5c' -strokewidth 1 -fill none -draw "roundrectangle 0,0 45,45 8,8" \\
              -stroke none -fill white -font DejaVu-Sans -pointsize 20 -gravity center -annotate +0+0 "📞" \\) \\
              -gravity east -geometry +65+0 -composite \\
          \\( -size 46x46 xc:'#16233a' -stroke '#2a3b5c' -strokewidth 1 -fill none -draw "roundrectangle 0,0 45,45 8,8" \\
              -stroke none -fill white -font DejaVu-Sans -pointsize 20 -gravity center -annotate +0+0 "🎥" \\) \\
              -gravity east -geometry +12+0 -composite \\
      \\) -gravity northwest -geometry +30+405 -composite \\
      \\( -size 460x88 xc:'#111b2d' -stroke '#1e2c45' -strokewidth 1 -fill none -draw "roundrectangle 0,0 459,87 12,12" \\
          -stroke none -fill '#06b6d4' -draw "circle 45,44 45,20" \\
          -fill white -font DejaVu-Sans-Bold -pointsize 22 -gravity west -annotate +35+0 "M" \\
          -fill white -font DejaVu-Sans-Bold -pointsize 19 -gravity west -annotate +85-12 "Mom & Dad TV" \\
          -fill '#94a3b8' -font DejaVu-Sans -pointsize 14 -gravity west -annotate +85+14 "UID: 9291404837 • Living Room" \\
          \\( -size 46x46 xc:'#16233a' -stroke '#2a3b5c' -strokewidth 1 -fill none -draw "roundrectangle 0,0 45,45 8,8" \\
              -stroke none -fill white -font DejaVu-Sans -pointsize 20 -gravity center -annotate +0+0 "📞" \\) \\
              -gravity east -geometry +65+0 -composite \\
          \\( -size 46x46 xc:'#16233a' -stroke '#2a3b5c' -strokewidth 1 -fill none -draw "roundrectangle 0,0 45,45 8,8" \\
              -stroke none -fill white -font DejaVu-Sans -pointsize 20 -gravity center -annotate +0+0 "🎥" \\) \\
              -gravity east -geometry +12+0 -composite \\
      \\) -gravity northwest -geometry +30+510 -composite \\
  \\) -gravity northwest -geometry +40+120 -composite \\
  \\( -size 1280x920 xc:'#0c1424' -stroke '#1e2c45' -strokewidth 1 -fill none -draw "roundrectangle 0,0 1279,919 16,16" \\
      \\( assets/icon.png -resize 180x180 \\( +clone -background '#00d2aa' -shadow 70x25+0+0 \\) +swap -background none -flatten \\) \\
      -gravity center -geometry +0-120 -composite \\
      \\( -background none -fill white -font DejaVu-Sans-Bold -pointsize 54 label:"Ready to Connect" \\) \\
      -gravity center -geometry +0+40 -composite \\
      \\( -background none -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 24 label:"Select a contact on the left or enter a 10-digit UID to start calling" \\) \\
      -gravity center -geometry +0+105 -composite \\
      \\( -background none -fill '#94a3b8' -font DejaVu-Sans -pointsize 19 label:"Tip: Hold the Mic button on your Fire TV Remote and say: \\"Alexa, ask ZingTalk to call Rahul\\"" \\) \\
      -gravity center -geometry +0+160 -composite \\
      \\( -size 780x70 xc:'#111a2d' -stroke '#00a8e1' -strokewidth 1 -fill none -draw "roundrectangle 0,0 779,69 12,12" \\
          -stroke none -fill '#00d2ff' -font DejaVu-Sans-Bold -pointsize 18 -gravity center -annotate +0+0 "🎮 Optimized for Fire TV Remote D-Pad • Full Hands-Free Alexa Support" \\) \\
          -gravity center -geometry +0+250 -composite \\
  \\) -gravity northeast -geometry +40+120 -composite \\
  -alpha off amazon_submission_assets/06_screenshot_1_dashboard_1920x1080.png
""")

print("7. Creating Screenshot 2 (1920x1080): HD Video Call Stage (1080p)...")
run("""
convert -size 1920x1080 xc:'#060911' \\
  \\( -size 1920x1080 gradient:'#0b1220'-'#04070d' \\) -composite \\
  \\( -size 1920x100 xc:'#070d18cc' \\
      -stroke none -fill '#00d2aa' -draw "circle 60,50 60,28" \\
      -fill '#070c14' -font DejaVu-Sans-Bold -pointsize 24 -gravity west -annotate +49+0 "R" \\
      -fill white -font DejaVu-Sans-Bold -pointsize 26 -gravity west -annotate +100-10 "Rahul Sharma" \\
      -fill '#94a3b8' -font DejaVu-Sans -pointsize 15 -gravity west -annotate +100+16 "UID: 1065736144 • Mobile" \\
      \\( -size 240x44 xc:'#00d29d22' -stroke '#00d2aa' -strokewidth 1 -fill none -draw "roundrectangle 0,0 239,43 22,22" \\
          -stroke none -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 16 -gravity center -annotate +0+0 "● Connected • 14:28" \\) \\
          -gravity east -geometry +40+0 -composite \\
      \\( -size 150x44 xc:'#00a8e122' -stroke '#00a8e1' -strokewidth 1 -fill none -draw "roundrectangle 0,0 149,43 22,22" \\
          -stroke none -fill '#00d2ff' -font DejaVu-Sans-Bold -pointsize 15 -gravity center -annotate +0+0 "1080p 60fps" \\) \\
          -gravity east -geometry +300+0 -composite \\
  \\) -gravity north -composite \\
  \\( -size 1920x760 xc:'#0f192b' \\
      -fill '#16233c' -draw "rectangle 0,0 1920,760" \\
      \\( -size 300x300 xc:'#1e2f4f' -draw "circle 150,150 150,30" \\
          -fill white -font DejaVu-Sans-Bold -pointsize 110 -gravity center -annotate +0+0 "R" \\) \\
          -gravity center -geometry +0-40 -composite \\
      \\( -background none -fill white -font DejaVu-Sans-Bold -pointsize 38 label:"Rahul Sharma (HD Video Feed)" \\) \\
      -gravity center -geometry +0+160 -composite \\
      \\( -background none -fill '#00d2aa' -font DejaVu-Sans -pointsize 20 label:"Encrypted WebRTC Peer-to-Peer Stream • Sub-Second Latency" \\) \\
      -gravity center -geometry +0+210 -composite \\
  \\) -gravity center -geometry +0-20 -composite \\
  \\( -size 340x220 xc:'#0a101d' -stroke '#00d2aa' -strokewidth 3 -fill none -draw "roundrectangle 0,0 339,219 14,14" \\
      -stroke none -fill '#141e33' -draw "roundrectangle 3,3 336,216 11,11" \\
      -fill '#00d2aa' -draw "circle 170,95 170,45" \\
      -fill '#070c14' -font DejaVu-Sans-Bold -pointsize 42 -gravity center -annotate +0-15 "A" \\
      -fill white -font DejaVu-Sans-Bold -pointsize 17 -gravity south -annotate +0+28 "Amit (You - Living Room TV)" \\
  \\) -gravity southeast -geometry +60+160 -composite \\
  \\( -size 680x90 xc:'#070d1acc' -stroke '#1e2c45' -strokewidth 1 -fill none -draw "roundrectangle 0,0 679,89 45,45" \\
      \\( -size 160x60 xc:'#152238' -stroke '#2a3f66' -strokewidth 1 -fill none -draw "roundrectangle 0,0 159,59 30,30" \\
          -stroke none -fill white -font DejaVu-Sans-Bold -pointsize 17 -gravity center -annotate +0+0 "🎤 Mute" \\) \\
          -gravity west -geometry +20+0 -composite \\
      \\( -size 160x60 xc:'#152238' -stroke '#2a3f66' -strokewidth 1 -fill none -draw "roundrectangle 0,0 159,59 30,30" \\
          -stroke none -fill white -font DejaVu-Sans-Bold -pointsize 17 -gravity center -annotate +0+0 "📷 Camera" \\) \\
          -gravity center -geometry -60+0 -composite \\
      \\( -size 200x60 xc:'#ff3b30' -stroke none -fill none -draw "roundrectangle 0,0 199,59 30,30" \\
          -stroke none -fill white -font DejaVu-Sans-Bold -pointsize 18 -gravity center -annotate +0+0 "🔴 Hang Up" \\) \\
          -gravity east -geometry +20+0 -composite \\
  \\) -gravity south -geometry +0+40 -composite \\
  -alpha off amazon_submission_assets/07_screenshot_2_videocall_1920x1080.png
""")

print("8. Creating Screenshot 3 (1920x1080): HD Audio Calling Page with Visualizer...")
run("""
convert -size 1920x1080 xc:'#070c14' \\
  \\( -size 1920x1080 radial-gradient:'#132238'-'#060a12' \\) -composite \\
  \\( -size 1920x100 xc:'#070d18cc' \\
      -stroke none -fill '#00a8e1' -draw "circle 60,50 60,28" \\
      -fill '#070c14' -font DejaVu-Sans-Bold -pointsize 24 -gravity west -annotate +49+0 "M" \\
      -fill white -font DejaVu-Sans-Bold -pointsize 26 -gravity west -annotate +100-10 "Mom & Dad TV" \\
      -fill '#94a3b8' -font DejaVu-Sans -pointsize 15 -gravity west -annotate +100+16 "UID: 9291404837 • Fire TV" \\
      \\( -size 240x44 xc:'#00a8e122' -stroke '#00a8e1' -strokewidth 1 -fill none -draw "roundrectangle 0,0 239,43 22,22" \\
          -stroke none -fill '#00d2ff' -font DejaVu-Sans-Bold -pointsize 16 -gravity center -annotate +0+0 "● HD Voice • 08:42" \\) \\
          -gravity east -geometry +40+0 -composite \\
  \\) -gravity north -composite \\
  \\( -size 460x460 xc:none \\
      -stroke '#00d2aa22' -strokewidth 3 -fill none -draw "circle 230,230 230,20" \\
      -stroke '#00d2aa44' -strokewidth 3 -fill none -draw "circle 230,230 230,80" \\
      -stroke '#00d2aa88' -strokewidth 3 -fill none -draw "circle 230,230 230,140" \\
      -stroke none -fill '#00d2aa' -draw "circle 230,230 230,175" \\
      -fill '#070c14' -font DejaVu-Sans-Bold -pointsize 84 -gravity center -annotate +0+0 "🎙️" \\
  \\) -gravity center -geometry +0-80 -composite \\
  \\( -background none -fill white -font DejaVu-Sans-Bold -pointsize 44 label:"High Definition Voice Calling" \\) \\
  -gravity center -geometry +0+200 -composite \\
  \\( -background none -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 22 label:"End-to-End Encrypted Voice • Low-Latency Audio Optimized for TV Speakers" \\) \\
  -gravity center -geometry +0+255 -composite \\
  \\( -size 760x90 xc:'#070d1acc' -stroke '#1e2c45' -strokewidth 1 -fill none -draw "roundrectangle 0,0 759,89 45,45" \\
      \\( -size 180x60 xc:'#152238' -stroke '#2a3f66' -strokewidth 1 -fill none -draw "roundrectangle 0,0 179,59 30,30" \\
          -stroke none -fill white -font DejaVu-Sans-Bold -pointsize 17 -gravity center -annotate +0+0 "🎤 Mute" \\) \\
          -gravity west -geometry +20+0 -composite \\
      \\( -size 200x60 xc:'#00a8e133' -stroke '#00a8e1' -strokewidth 1 -fill none -draw "roundrectangle 0,0 199,59 30,30" \\
          -stroke none -fill '#00d2ff' -font DejaVu-Sans-Bold -pointsize 17 -gravity center -annotate +0+0 "📹 Switch to Video" \\) \\
          -gravity center -geometry -20+0 -composite \\
      \\( -size 190x60 xc:'#ff3b30' -stroke none -fill none -draw "roundrectangle 0,0 189,59 30,30" \\
          -stroke none -fill white -font DejaVu-Sans-Bold -pointsize 18 -gravity center -annotate +0+0 "🔴 Hang Up" \\) \\
          -gravity east -geometry +20+0 -composite \\
  \\) -gravity south -geometry +0+50 -composite \\
  -alpha off amazon_submission_assets/08_screenshot_3_audiocall_1920x1080.png
""")

print("9. Creating Screenshot 4 (1920x1080): Active TV Conversation & Messaging...")
run("""
convert -size 1920x1080 xc:'#070c14' \\
  \\( -size 1920x90 xc:'#0a1220' -fill '#182336' -draw "line 0,89 1920,89" \\
      \\( assets/icon.png -resize 50x50 \\) -gravity west -geometry +40+0 -composite \\
      \\( -background none -fill white -font DejaVu-Sans-Bold -pointsize 28 label:"ZingTalk TV" \\) -gravity west -geometry +105+0 -composite \\
      \\( -size 240x44 xc:'#00a8e133' -stroke '#00a8e1' -strokewidth 1 -fill none -draw "roundrectangle 0,0 239,43 8,8" \\
          -stroke none -fill '#00d2ff' -font DejaVu-Sans-Bold -pointsize 16 -gravity center -annotate +0+0 "🎙️ Alexa Voice Active" \\) \\
          -gravity east -geometry +560+0 -composite \\
      \\( -size 200x44 xc:'#00d29d22' -stroke '#00d29d' -strokewidth 1 -fill none -draw "roundrectangle 0,0 199,43 8,8" \\
          -stroke none -fill '#00d29d' -font DejaVu-Sans-Bold -pointsize 16 -gravity center -annotate +0+0 "● AWS Cloud Online" \\) \\
          -gravity east -geometry +330+0 -composite \\
      \\( -size 270x52 xc:'#151f32' -stroke '#22324e' -strokewidth 1 -fill none -draw "roundrectangle 0,0 269,51 26,26" \\
          -stroke none -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 22 -gravity west -annotate +15+0 "A" \\
          -fill white -font DejaVu-Sans-Bold -pointsize 17 -gravity west -annotate +50-8 "Amit FireTV" \\
          -fill '#00d29d' -font DejaVu-Sans -pointsize 13 -gravity west -annotate +50+12 "UID: 2943612054" \\) \\
          -gravity east -geometry +40+0 -composite \\
  \\) -gravity north -composite \\
  \\( -size 520x920 xc:'#0c1424' -stroke '#1e2c45' -strokewidth 1 -fill none -draw "roundrectangle 0,0 519,919 16,16" \\
      -stroke none -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 13 -gravity northwest -annotate +30+30 "QUICK CONNECT" \\
      \\( -size 460x60 xc:'#131d31' -stroke '#00d2aa' -strokewidth 2 -fill none -draw "roundrectangle 0,0 459,59 10,10" \\
          -stroke none -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 26 -gravity center -annotate +0+0 "1065736144" \\) \\
          -gravity northwest -geometry +30+60 -composite \\
      -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 13 -gravity northwest -annotate +30+145 "CONVERSATIONS" \\
      \\( -size 460x88 xc:'#152238' -stroke '#00d2aa' -strokewidth 2 -fill none -draw "roundrectangle 0,0 459,87 12,12" \\
          -stroke none -fill '#00d2aa' -draw "circle 45,44 45,20" \\
          -fill '#070c14' -font DejaVu-Sans-Bold -pointsize 22 -gravity west -annotate +35+0 "R" \\
          -fill white -font DejaVu-Sans-Bold -pointsize 19 -gravity west -annotate +85-12 "Rahul Sharma" \\
          -fill '#00d29d' -font DejaVu-Sans-Bold -pointsize 14 -gravity west -annotate +85+14 "See you on the TV call! • Active" \\
      \\) -gravity northwest -geometry +30+175 -composite \\
      \\( -size 460x88 xc:'#111b2d' -stroke '#1e2c45' -strokewidth 1 -fill none -draw "roundrectangle 0,0 459,87 12,12" \\
          -stroke none -fill '#a855f7' -draw "circle 45,44 45,20" \\
          -fill white -font DejaVu-Sans-Bold -pointsize 22 -gravity west -annotate +35+0 "P" \\
          -fill white -font DejaVu-Sans-Bold -pointsize 19 -gravity west -annotate +85-12 "Priya Patel" \\
          -fill '#94a3b8' -font DejaVu-Sans -pointsize 14 -gravity west -annotate +85+14 "Voice message received • 15:10" \\
      \\) -gravity northwest -geometry +30+280 -composite \\
  \\) -gravity northwest -geometry +40+120 -composite \\
  \\( -size 1280x920 xc:'#0c1424' -stroke '#1e2c45' -strokewidth 1 -fill none -draw "roundrectangle 0,0 1279,919 16,16" \\
      \\( -size 1280x80 xc:'#0f1a2e' \\
          -stroke none -fill '#00d2aa' -draw "circle 50,40 50,18" \\
          -fill '#070c14' -font DejaVu-Sans-Bold -pointsize 20 -gravity west -annotate +42+0 "R" \\
          -fill white -font DejaVu-Sans-Bold -pointsize 22 -gravity west -annotate +85-10 "Rahul Sharma" \\
          -fill '#00d29d' -font DejaVu-Sans -pointsize 14 -gravity west -annotate +85+14 "Online • UID: 1065736144" \\
          \\( -size 140x44 xc:'#00a8e133' -stroke '#00a8e1' -strokewidth 1 -fill none -draw "roundrectangle 0,0 139,43 8,8" \\
              -stroke none -fill '#00d2ff' -font DejaVu-Sans-Bold -pointsize 15 -gravity center -annotate +0+0 "📞 Audio" \\) \\
              -gravity east -geometry +180+0 -composite \\
          \\( -size 150x44 xc:'#00d2aa' -draw "roundrectangle 0,0 149,43 8,8" \\
              -fill '#070c14' -font DejaVu-Sans-Bold -pointsize 15 -gravity center -annotate +0+0 "🎥 Video Call" \\) \\
              -gravity east -geometry +20+0 -composite \\
      \\) -gravity north -composite \\
      \\( -size 580x64 xc:'#16243b' -stroke '#243759' -strokewidth 1 -fill none -draw "roundrectangle 0,0 579,63 12,12" \\
          -stroke none -fill white -font DejaVu-Sans -pointsize 18 -gravity west -annotate +20-8 "Hey Amit, are you ready for the Fire TV call?" \\
          -fill '#64748b' -font DejaVu-Sans -pointsize 12 -gravity east -annotate +20+16 "15:48" \\) \\
          -gravity northwest -geometry +40+120 -composite \\
      \\( -size 620x64 xc:'#00d2aa' -draw "roundrectangle 0,0 619,63 12,12" \\
          -fill '#070c14' -font DejaVu-Sans-Bold -pointsize 18 -gravity west -annotate +20-8 "Yes! Sitting right in front of the living room TV now." \\
          -fill '#083327' -font DejaVu-Sans-Bold -pointsize 12 -gravity east -annotate +20+16 "15:49 ✓✓" \\) \\
          -gravity northeast -geometry +40+205 -composite \\
      \\( -size 520x64 xc:'#16243b' -stroke '#243759' -strokewidth 1 -fill none -draw "roundrectangle 0,0 519,63 12,12" \\
          -stroke none -fill white -font DejaVu-Sans -pointsize 18 -gravity west -annotate +20-8 "Awesome, starting the HD video stream!" \\
          -fill '#64748b' -font DejaVu-Sans -pointsize 12 -gravity east -annotate +20+16 "15:50" \\) \\
          -gravity northwest -geometry +40+290 -composite \\
      \\( -size 1200x70 xc:'#111b2d' -stroke '#00d2aa' -strokewidth 2 -fill none -draw "roundrectangle 0,0 1199,69 12,12" \\
          -stroke none -fill '#94a3b8' -font DejaVu-Sans -pointsize 19 -gravity west -annotate +30+0 "Type message or hold remote mic to dictate..." \\
          \\( -size 80x50 xc:'#00d2aa' -draw "roundrectangle 0,0 79,49 8,8" \\
              -fill '#070c14' -font DejaVu-Sans-Bold -pointsize 20 -gravity center -annotate +0+0 "➤" \\) \\
              -gravity east -geometry +10+0 -composite \\
      \\) -gravity south -geometry +0+25 -composite \\
  \\) -gravity northeast -geometry +40+120 -composite \\
  -alpha off amazon_submission_assets/09_screenshot_4_chat_1920x1080.png
""")

print("10. Creating Screenshot 5 (1920x1080): Alexa Hands-Free Voice Commands Guide...")
run("""
convert -size 1920x1080 xc:'#070c14' \\
  \\( -size 1920x1080 radial-gradient:'#0d192d'-'#060a12' \\) -composite \\
  \\( -size 1920x90 xc:'#0a1220' -fill '#182336' -draw "line 0,89 1920,89" \\
      \\( assets/icon.png -resize 50x50 \\) -gravity west -geometry +40+0 -composite \\
      \\( -background none -fill white -font DejaVu-Sans-Bold -pointsize 28 label:"ZingTalk TV" \\) -gravity west -geometry +105+0 -composite \\
      \\( -size 240x44 xc:'#00a8e1' -draw "roundrectangle 0,0 239,43 8,8" \\
          -fill '#070c14' -font DejaVu-Sans-Bold -pointsize 16 -gravity center -annotate +0+0 "🎙️ Alexa Voice Active" \\) \\
          -gravity east -geometry +40+0 -composite \\
  \\) -gravity north -composite \\
  \\( -size 1300x860 xc:'#0b1424' -stroke '#00a8e1' -strokewidth 2 -fill none -draw "roundrectangle 0,0 1299,859 18,18" \\
      -stroke none -fill white -font DejaVu-Sans-Bold -pointsize 36 -gravity northwest -annotate +50+40 "🎙️ Alexa Voice Commands & Fire TV Remote Guide" \\
      -fill '#00d2ff' -font DejaVu-Sans-Bold -pointsize 20 -gravity northwest -annotate +50+90 "Operate ZingTalk 100% hands-free using your physical Fire TV Voice Remote" \\
      \\( -size 1200x120 xc:'#0a253a' -stroke '#00a8e1' -strokewidth 1 -fill none -draw "roundrectangle 0,0 1199,119 12,12" \\
          -stroke none -fill '#38bdf8' -font DejaVu-Sans-Bold -pointsize 22 -gravity northwest -annotate +30+20 "HOW TO USE VOICE CONTROL ON FIRE TV:" \\
          -fill white -font DejaVu-Sans -pointsize 18 -gravity northwest -annotate +30+55 "Press & hold the Microphone button on your Fire TV remote, speak any command, then release." \\
          -fill '#7dd3fc' -font DejaVu-Sans -pointsize 16 -gravity northwest -annotate +30+85 "Commands are executed instantly by AWS Cloud with sub-second response times." \\
      \\) -gravity northwest -geometry +50+140 -composite \\
      \\( -size 580x250 xc:'#111b2e' -stroke '#1e2f4a' -strokewidth 1 -fill none -draw "roundrectangle 0,0 579,249 12,12" \\
          -stroke none -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 22 -gravity northwest -annotate +25+20 "📞 Calling Commands" \\
          -fill white -font DejaVu-Sans -pointsize 17 -gravity northwest -annotate +25+65 "• \\"Alexa, ask ZingTalk to call Rahul\\"" \\
          -fill white -font DejaVu-Sans -pointsize 17 -gravity northwest -annotate +25+105 "• \\"Alexa, ask ZingTalk to video call Mom\\"" \\
          -fill white -font DejaVu-Sans -pointsize 17 -gravity northwest -annotate +25+145 "• \\"Alexa, ask ZingTalk to call UID 1065736144\\"" \\
          -fill white -font DejaVu-Sans -pointsize 17 -gravity northwest -annotate +25+185 "• \\"Alexa, tell ZingTalk to redial\\"" \\
      \\) -gravity northwest -geometry +50+290 -composite \\
      \\( -size 580x250 xc:'#111b2e' -stroke '#1e2f4a' -strokewidth 1 -fill none -draw "roundrectangle 0,0 579,249 12,12" \\
          -stroke none -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 22 -gravity northwest -annotate +25+20 "🟢 Call Control Commands" \\
          -fill white -font DejaVu-Sans -pointsize 17 -gravity northwest -annotate +25+65 "• \\"Alexa, tell ZingTalk to answer call\\"" \\
          -fill white -font DejaVu-Sans -pointsize 17 -gravity northwest -annotate +25+105 "• \\"Alexa, tell ZingTalk to decline call\\"" \\
          -fill white -font DejaVu-Sans -pointsize 17 -gravity northwest -annotate +25+145 "• \\"Alexa, tell ZingTalk to mute microphone\\"" \\
          -fill white -font DejaVu-Sans -pointsize 17 -gravity northwest -annotate +25+185 "• \\"Alexa, tell ZingTalk to hang up\\"" \\
      \\) -gravity northeast -geometry +50+290 -composite \\
      \\( -size 580x230 xc:'#111b2e' -stroke '#1e2f4a' -strokewidth 1 -fill none -draw "roundrectangle 0,0 579,229 12,12" \\
          -stroke none -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 22 -gravity northwest -annotate +25+20 "💬 Messaging & Navigation" \\
          -fill white -font DejaVu-Sans -pointsize 17 -gravity northwest -annotate +25+65 "• \\"Alexa, ask ZingTalk to chat with Rahul\\"" \\
          -fill white -font DejaVu-Sans -pointsize 17 -gravity northwest -annotate +25+105 "• \\"Alexa, tell ZingTalk to send See you tonight\\"" \\
          -fill white -font DejaVu-Sans -pointsize 17 -gravity northwest -annotate +25+145 "• \\"Alexa, ask ZingTalk who can I call\\"" \\
          -fill white -font DejaVu-Sans -pointsize 17 -gravity northwest -annotate +25+185 "• \\"Alexa, ask ZingTalk what is my ID\\"" \\
      \\) -gravity northwest -geometry +50+570 -composite \\
      \\( -size 580x230 xc:'#111b2e' -stroke '#1e2f4a' -strokewidth 1 -fill none -draw "roundrectangle 0,0 579,229 12,12" \\
          -stroke none -fill '#00d2aa' -font DejaVu-Sans-Bold -pointsize 22 -gravity northwest -annotate +25+20 "🎮 D-Pad Remote Controls" \\
          -fill white -font DejaVu-Sans -pointsize 17 -gravity northwest -annotate +25+65 "• Directional Arrows: Smooth spatial focus" \\
          -fill white -font DejaVu-Sans -pointsize 17 -gravity northwest -annotate +25+105 "• Center OK/Select: 1-Click speed dial" \\
          -fill white -font DejaVu-Sans -pointsize 17 -gravity northwest -annotate +25+145 "• Back Button: Safe navigation (guards calls)" \\
          -fill white -font DejaVu-Sans -pointsize 17 -gravity northwest -annotate +25+185 "• Menu (☰) Button: Opens this voice guide" \\
      \\) -gravity northeast -geometry +50+570 -composite \\
  \\) -gravity center -geometry +0+40 -composite \\
  -alpha off amazon_submission_assets/10_screenshot_5_alexa_guide_1920x1080.png
""")

# Also copy to public/amazon_assets for direct web preview/download
import shutil
for f in os.listdir("amazon_submission_assets"):
    shutil.copy(os.path.join("amazon_submission_assets", f), os.path.join("public/amazon_assets", f))

print("All Amazon Appstore Assets Generated Successfully!")
