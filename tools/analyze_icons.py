import re

with open(r'd:\work\geo-v5r7w2mBq8-main\icons-raw.svg', encoding='utf-8') as f:
    content = f.read()

# Extract all M (moveto) coordinates to find starting points of each path
starts = re.findall(r'M\s*([\d.]+)\s+([\d.]+)', content)
points = [(float(x), float(y)) for x, y in starts]

# Also extract all numeric coordinates to find bounding boxes per region
# Split into 4x4 grid: each cell is 256x256 in 1024x1024
grid = {}
for x, y in points:
    col = min(int(x // 256), 3)
    row = min(int(y // 256), 3)
    if (col, row) not in grid:
        grid[(col, row)] = {'xs': [], 'ys': []}
    grid[(col, row)]['xs'].append(x)
    grid[(col, row)]['ys'].append(y)

labels = [
    ['スポット','スーパー','駅/バス停','レストラン'],
    ['カフェ','像','テイクアウト','ミュージアム'],
    ['ラーメン','うどん','そば','観光スポット'],
    ['寿司','ドラッグストア','100円ショップ','ホテル'],
]

print("アイコンごとのpath開始座標の範囲：")
for row in range(4):
    for col in range(4):
        key = (col, row)
        if key in grid:
            xs = grid[key]['xs']
            ys = grid[key]['ys']
            print(f"({col},{row}) {labels[row][col]}: x=[{min(xs):.0f},{max(xs):.0f}] y=[{min(ys):.0f},{max(ys):.0f}]")
        else:
            print(f"({col},{row}) {labels[row][col]}: データなし")
