"""生成带 EXIF/GPS/方向标签的测试图片（JPEG / PNG / WebP）。"""
import os
from PIL import Image
from PIL.PngImagePlugin import PngInfo

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'imgs')
os.makedirs(OUT, exist_ok=True)


def build_exif(orientation=None):
    exif = Image.Exif()
    exif[0x0110] = 'TestCam'                      # Make
    exif[0x0132] = '2024:01:01 10:00:00'          # DateTime
    if orientation:
        exif[0x0112] = orientation                # Orientation
    gps = exif.get_ifd(0x8825)                    # GPS IFD
    gps[1] = 'N'
    gps[2] = (39.9083, 54.5, 30.0)
    gps[3] = 'E'
    gps[4] = (116.3914, 23.48, 29.0)
    return exif


# 1) JPEG：EXIF + GPS + Orientation=6（竖拍）
img1 = Image.new('RGB', (80, 60), (180, 60, 60))
img1.save(os.path.join(OUT, 'with_gps.jpg'), exif=build_exif(6))

# 2) JPEG：EXIF + GPS，无方向标签（横拍）
img2 = Image.new('RGB', (100, 50), (60, 120, 200))
img2.save(os.path.join(OUT, 'plain_exif.jpg'), exif=build_exif())

# 3) JPEG：完全无 EXIF
img3 = Image.new('RGB', (64, 48), (90, 160, 90))
img3.save(os.path.join(OUT, 'no_exif.jpg'))

# 4) PNG：eXIf 块 + tEXt 块
exif4 = Image.Exif()
exif4[0x0132] = '2023:01:01 00:00:00'
pi = PngInfo()
pi.add_text('Comment', 'secret note')
img4 = Image.new('RGB', (64, 64), (60, 180, 90))
img4.save(os.path.join(OUT, 'with_exif.png'), exif=exif4, pnginfo=pi)

# 5) WebP：EXIF 块
exif5 = Image.Exif()
exif5[0x0110] = 'TestCam'
img5 = Image.new('RGB', (48, 48), (200, 200, 60))
img5.save(os.path.join(OUT, 'with_exif.webp'), exif=exif5.tobytes())

# 生成后自检：确认夹具真的带元数据
for name in ('with_gps.jpg', 'plain_exif.jpg'):
    im = Image.open(os.path.join(OUT, name))
    e = im.getexif()
    assert len(e) > 0, f'{name} 缺少 EXIF'
    assert len(e.get_ifd(0x8825)) > 0, f'{name} 缺少 GPS'
    print(f'{name}: EXIF tags={len(e)}, orientation={e.get(0x0112)}, GPS entries={len(e.get_ifd(0x8825))}')

raw = open(os.path.join(OUT, 'with_exif.png'), 'rb').read()
assert b'eXIf' in raw and b'tEXt' in raw, 'PNG 夹具缺少 eXIf/tEXt 块'
print('with_exif.png: eXIf + tEXt 块存在')

raw = open(os.path.join(OUT, 'with_exif.webp'), 'rb').read()
assert b'EXIF' in raw, 'WebP 夹具缺少 EXIF 块'
print('with_exif.webp: EXIF 块存在')
print('全部夹具生成完毕 ->', OUT)
