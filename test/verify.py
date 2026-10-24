"""用 Pillow 独立交叉验证剥离输出：可解码、EXIF 为空、像素未变。"""
import os
from PIL import Image, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
IMGS = os.path.join(HERE, 'imgs')
OUT = os.path.join(HERE, 'out')

fails = []
def check(name, cond, extra=''):
    print(('PASS' if cond else 'FAIL'), name, extra)
    if not cond:
        fails.append(name)

# 1) 竖拍 GPS JPEG：EXIF 全空、尺寸不变
im = Image.open(os.path.join(OUT, 'with_gps_noexif.jpg'))
e = im.getexif()
check('with_gps_noexif.jpg 可解码', im.size == (80, 60), str(im.size))
check('EXIF 完全为空', len(e) == 0, f'残留 tags: {list(e.keys())}')
check('GPS IFD 为空', len(e.get_ifd(0x8825)) == 0)
check('方向标签不存在', e.get(0x0112) is None)

# 2) 横拍 JPEG：EXIF 为空 + 像素逐位一致（无损）
orig = Image.open(os.path.join(IMGS, 'plain_exif.jpg')).convert('RGB')
new = Image.open(os.path.join(OUT, 'plain_exif_noexif.jpg')).convert('RGB')
check('plain_exif_noexif.jpg EXIF 为空', len(new.getexif()) == 0, f'残留: {list(new.getexif().keys())}')
diff = ImageChops.difference(orig, new).getbbox()
check('plain_exif_noexif.jpg 像素无损', diff is None, str(diff))

# 3) PNG：eXIf/tEXt 块不在、像素无损
raw = open(os.path.join(OUT, 'with_exif_noexif.png'), 'rb').read()
check('PNG 无 eXIf/tEXt 块', b'eXIf' not in raw and b'tEXt' not in raw)
orig = Image.open(os.path.join(IMGS, 'with_exif.png')).convert('RGB')
new = Image.open(os.path.join(OUT, 'with_exif_noexif.png')).convert('RGB')
diff = ImageChops.difference(orig, new).getbbox()
check('PNG 像素无损', diff is None, str(diff))
check('PNG 无 EXIF 信息', not new.getexif() and not new.info.get('exif'))

# 4) WebP：EXIF 块不在、可解码
raw = open(os.path.join(OUT, 'with_exif_noexif.webp'), 'rb').read()
check('WebP 无 EXIF 块', b'EXIF' not in raw[:64] and b'EXIF' not in raw)
im = Image.open(os.path.join(OUT, 'with_exif_noexif.webp'))
check('WebP 可解码', im.size == (48, 48), str(im.size))
check('WebP 无 EXIF 信息', not im.info.get('exif'))

print('\n' + ('全部通过' if not fails else f'{len(fails)} 项失败: {fails}'))
exit(1 if fails else 0)
