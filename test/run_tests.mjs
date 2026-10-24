/**
 * 从 index.html 中抽取 CORE 区块，对核心剥离逻辑做结构化测试。
 * 运行：node test/run_tests.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const m = html.match(/\/\*CORE-BEGIN\*\/([\s\S]*?)\/\*CORE-END\*\//);
if (!m) throw new Error('index.html 中找不到 CORE 标记');
const { detectFormat, parseExif, stripJpeg, stripPng, stripWebp, stripGif, outName } =
  new Function(m[1] + '\nreturn { detectFormat, parseExif, stripJpeg, stripPng, stripWebp, stripGif, outName };')();

let failed = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
  if (!cond) failed++;
}

/* ---- 独立的结构扫描器（用于验证输出，不复用被测代码的判断） ---- */
function scanJpegMarkers(b) {
  const found = { exifApp1: false, xmpApp1: false, com: false, app13: false, sos: false };
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xFF) return Object.assign(found, { truncated: true });
    const mk = b[i + 1];
    if (mk === 0x01 || mk === 0xD8 || (mk >= 0xD0 && mk <= 0xD7)) { i += 2; continue; }
    if (mk === 0xD9) return found;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (mk === 0xDA) { found.sos = true; return found; }
    const id = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (mk === 0xE1 && id === 'Exif') found.exifApp1 = true;
    if (mk === 0xE1 && id === 'http') found.xmpApp1 = true;
    if (mk === 0xFE) found.com = true;
    if (mk === 0xED) found.app13 = true;
    i += 2 + len;
  }
  return found;
}
function scanPngChunks(b) {
  const types = [];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 8, consumed = 0;
  while (i + 8 <= b.length) {
    const len = dv.getUint32(i);
    const t = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    types.push(t);
    i += 12 + len;
    consumed = i;
    if (t === 'IEND') break;
  }
  return { types, exact: i === b.length, trailing: b.length - i };
}
function scanWebpChunks(b) {
  const ccs = [];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 12;
  while (i + 8 <= b.length) {
    const cc = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    const sz = dv.getUint32(i + 4, true);
    ccs.push(cc);
    i += 8 + sz + (sz & 1);
  }
  return { ccs, exact: i === b.length };
}

/* ---- 测试 ---- */
const read = (p) => new Uint8Array(fs.readFileSync(path.join(HERE, 'imgs', p)));
const write = (p, b) => fs.writeFileSync(path.join(OUT, p), b);

// 1. JPEG 带 GPS + Orientation=6
{
  const b = read('with_gps.jpg');
  check('with_gps 格式识别为 jpeg', detectFormat(b) === 'jpeg');
  const before = scanJpegMarkers(b);
  check('夹具本身含 EXIF APP1', before.exifApp1);
  const r = stripJpeg(b);
  check('stripJpeg 成功', r !== null);
  check('识别出 EXIF 段', r.rm.exif === true);
  check('识别出 GPS', r.gps === true);
  check('识别出 Orientation=6', r.orientation === 6, `实际 ${r.orientation}`);
  const after = scanJpegMarkers(r.out);
  check('输出不含 EXIF APP1', !after.exifApp1);
  check('输出不含 XMP/COM/APP13', !after.xmpApp1 && !after.com && !after.app13);
  check('输出含 SOS 且未被截断', after.sos && !after.truncated);
  check('输出以 SOI 开头 EOI 结尾', r.out[0] === 0xFF && r.out[1] === 0xD8 && r.out[r.out.length - 2] === 0xFF && r.out[r.out.length - 1] === 0xD9);
  check('输出体积缩小', r.out.length < b.length, `${b.length} -> ${r.out.length}`);
  write('with_gps_noexif.jpg', r.out);
}

// 2. JPEG 横拍（orientation=1，纯无损路径）
{
  const b = read('plain_exif.jpg');
  const r = stripJpeg(b);
  check('plain: 识别 EXIF 与 GPS', r.rm.exif === true && r.gps === true);
  check('plain: orientation=1', r.orientation === 1, `实际 ${r.orientation}`);
  const after = scanJpegMarkers(r.out);
  check('plain: 输出不含 EXIF APP1', !after.exifApp1);
  write('plain_exif_noexif.jpg', r.out);
}

// 3. JPEG 本来就没有 EXIF → 原样返回
{
  const b = read('no_exif.jpg');
  const r = stripJpeg(b);
  check('no_exif: 未发现任何可移除段', !r.rm.exif && !r.rm.xmp && !r.rm.ps && !r.rm.com && !r.rm.mpf);
  check('no_exif: 输出与输入逐字节一致', r.out.length === b.length && r.out.every((v, i) => v === b[i]));
}

// 4. PNG
{
  const b = read('with_exif.png');
  check('png 格式识别', detectFormat(b) === 'png');
  const before = scanPngChunks(b);
  check('夹具含 eXIf 与 tEXt 块', before.types.includes('eXIf') && before.types.includes('tEXt'));
  const r = stripPng(b);
  check('png: 识别 eXIf/tEXt', r.rm.exif === true && r.rm.text === true);
  const after = scanPngChunks(r.out);
  check('png: eXIf/tEXt 已移除', !after.types.includes('eXIf') && !after.types.includes('tEXt'));
  check('png: 保留 IHDR/IDAT/IEND', ['IHDR', 'IDAT', 'IEND'].every((t) => after.types.includes(t)));
  check('png: 块结构完整无残尾', after.exact && after.trailing === 0);
  write('with_exif_noexif.png', r.out);
}

// 5. WebP
{
  const b = read('with_exif.webp');
  check('webp 格式识别', detectFormat(b) === 'webp');
  const before = scanWebpChunks(b);
  check('夹具含 EXIF 块', before.ccs.includes('EXIF'));
  const r = stripWebp(b);
  check('webp: 识别 EXIF 块', r.rm.exif === true);
  const after = scanWebpChunks(r.out);
  check('webp: EXIF/XMP 已移除', !after.ccs.includes('EXIF') && !after.ccs.includes('XMP '));
  check('webp: RIFF 尺寸字段正确', (() => {
    const dv = new DataView(r.out.buffer, r.out.byteOffset, r.out.byteLength);
    return dv.getUint32(4, true) === r.out.length - 8;
  })());
  check('webp: 块结构精确消耗到文件尾', after.exact);
  check('webp: RIFF/WEBP 头保留', r.out[0] === 0x52 && String.fromCharCode(r.out[8], r.out[9], r.out[10], r.out[11]) === 'WEBP');
  write('with_exif_noexif.webp', r.out);
}

// 6. parseExif 大端（MM）字节序
{
  const t = new Uint8Array([
    0x4D, 0x4D, 0x00, 0x2A,             // MM *
    0x00, 0x00, 0x00, 0x08,             // IFD0 @ 8
    0x00, 0x01,                          // 1 个条目
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x08, 0x00, 0x00, // Orientation=8
    0x00, 0x00,                          // next IFD = 0
  ]);
  const r = parseExif(t);
  check('parseExif 大端 Orientation=8', r.orientation === 8, `实际 ${r.orientation}`);
}

// 7. HEIC / AVIF 探测
{
  const heic = new Uint8Array(12); heic.set([0, 0, 0, 0x18], 0);
  heic.set([0x66, 0x74, 0x79, 0x70], 4); heic.set([0x68, 0x65, 0x69, 0x63], 8);
  const avif = new Uint8Array(12); avif.set([0x66, 0x74, 0x79, 0x70], 4); avif.set([0x61, 0x76, 0x69, 0x66], 8);
  check('HEIC 识别', detectFormat(heic) === 'heic');
  check('AVIF 识别', detectFormat(avif) === 'avif');
}

// 8. GIF：用经典 1×1 GIF 字节序列现场构造夹具（含注释扩展 / 双帧动图）
{
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  write('tiny.gif', gif);
  const frame = gif.subarray(gif.indexOf(0x2C), gif.length - 1); // 图像块（到 trailer 前）
  const COM = (text) => Buffer.concat([Buffer.from([0x21, 0xFE, text.length]), Buffer.from(text), Buffer.from([0x00])]);
  const wc = Buffer.concat([gif.subarray(0, gif.length - 1), COM('secret note'), Buffer.from([0x3B])]);
  write('with_comment.gif', wc);
  const anim = Buffer.concat([gif.subarray(0, gif.length - 1), frame, frame, COM('anim'), Buffer.from([0x3B])]);
  write('animated_comment.gif', anim);
  const animClean = Buffer.concat([gif.subarray(0, gif.length - 1), frame, frame, Buffer.from([0x3B])]);

  check('gif 格式识别', detectFormat(wc) === 'gif');
  const r = stripGif(wc);
  check('gif: 识别注释扩展', r !== null && r.rm.com === true);
  check('gif: 剥离后与无注释原版逐字节一致',
    r.out.length === gif.length && Buffer.from(r.out).equals(gif));
  check('gif: 单帧判定为非动图', r.animated === false);
  const r0 = stripGif(gif);
  check('gif: 无注释时原样返回', r0.rm.com === false && Buffer.from(r0.out).equals(gif));
  const ra = stripGif(anim);
  check('gif: 动图识别（2 帧）', ra.animated === true && ra.rm.com === true);
  check('gif: 动图剥离后两帧完整保留', Buffer.from(ra.out).equals(animClean));
}

// 9. BMP：DataView 手工构造 24bpp 2×2
{
  const bmp = new Uint8Array(70);
  const dv = new DataView(bmp.buffer);
  bmp[0] = 0x42; bmp[1] = 0x4D;
  dv.setUint32(2, 70, true);   // 文件大小
  dv.setUint32(10, 54, true);  // 像素数据偏移
  dv.setUint32(14, 40, true);  // BITMAPINFOHEADER
  dv.setInt32(18, 2, true); dv.setInt32(22, 2, true);   // 2×2
  dv.setUint16(26, 1, true); dv.setUint16(28, 24, true); // 24bpp
  dv.setUint32(34, 16, true);  // 像素数据大小
  bmp.set([255, 0, 0, 0, 0, 255, 0, 0], 54);          // 底行：红 蓝 + 补齐
  bmp.set([0, 255, 0, 255, 255, 255, 0, 0], 62);      // 顶行：绿 白 + 补齐
  write('plain.bmp', bmp);
  check('bmp 格式识别', detectFormat(bmp) === 'bmp');
}

// 10. 输出文件名（outName）
{
  check('outName 默认保持扩展名', outName('photo.jpg') === 'photo_noexif.jpg');
  check('outName 转换时替换扩展名', outName('photo.png', 'image/jpeg') === 'photo_noexif.jpg');
  check('outName 同格式不改扩展名', outName('photo.webp', 'image/webp') === 'photo_noexif.webp');
  check('outName 大写扩展名归一', outName('PHOTO.JPG', 'image/jpeg') === 'PHOTO_noexif.jpg');
  check('outName 无扩展名补全', outName('photo', 'image/png') === 'photo_noexif.png');
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
