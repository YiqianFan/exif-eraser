# Exif Eraser · 照片 EXIF 一键抹除

> 单文件、零安装、纯离线的照片元数据清除工具。双击 `index.html` 即用，照片永远不离开你的设备。

手机拍的照片里藏着大量隐私信息：GPS 拍摄位置、拍摄时间、设备型号，甚至连拍索引和编辑软件痕迹（EXIF / XMP / IPTC）。发朋友圈、传群聊之前，用这个工具一键抹掉——**不需要安装任何软件，不需要联网，不上传任何字节**。

## 快速开始

| 场景 | 做法 |
|---|---|
| 电脑 | 双击 `index.html`，把照片拖进页面 |
| 手机 | 把文件发到手机后用浏览器打开；或在电脑上运行 `python -m http.server 8123`，手机连同一 Wi-Fi 访问 `http://<电脑IP>:8123/index.html` |
| 在线使用 | 克隆本仓库后任意静态托管（GitHub Pages / Netlify 均可），页面本身不含任何网络请求 |

处理完点单张"下载"或"全部下载"，输出文件自动加 `_noexif` 后缀，转换格式时扩展名跟随目标格式（如 `photo.png` 转 JPEG → `photo_noexif.jpg`）。

## 支持格式

| 输入格式 | 自动模式（默认） | 转换模式（选输出格式后） |
|---|---|---|
| JPEG | ✅ 字节级无损剥离，竖拍自动转正（重编码） | ✅ |
| PNG | ✅ 无损剥离 eXIf / 文本块 | ✅ |
| WebP | ✅ 无损剥离 EXIF / XMP 块 | ✅ |
| GIF（含动图） | ✅ 无损剥离注释 / XMP，所有帧保留 | ✅ 静态化（提示仅保留第一帧） |
| BMP | ✅ 本身不含 EXIF，如实标注 | ✅ |
| AVIF | ➖ 无法无损剥离，页面会引导转成其他格式 | ✅ |
| HEIC | ❌ 浏览器无法解码（iPhone 相册选图时 iOS 通常已自动转 JPEG） | ❌ |

**输出格式选项**：自动（保持原格式，优先无损）/ JPEG / PNG / WebP。切换后已加入的照片自动按新格式重新处理，切回自动恢复无损结果。重编码质量约 92%；转 JPEG 时透明背景自动填白；Safari / Firefox 不支持 WebP 编码时自动回退 PNG 并明确提示。

## 会移除什么 / 保留什么

**移除**：EXIF（拍摄时间、相机与镜头型号、GPS 定位、方向标签等）、XMP、IPTC/Photoshop 数据、JPEG 注释段、多图索引（MPF）、PNG 文本与时间块、GIF 注释与应用扩展。

**保留**：像素数据（无损路径逐位不变）、ICC 色彩配置、JFIF 结构信息。

**竖拍照片说明**：「方向」标签本身属于 EXIF。直接剥离会让照片显示成躺倒，所以方向不为 1 的 JPEG 会先用 canvas 转正再输出（此路径会重编码，画质几乎无损），其余照片全部走字节级无损剥离。

## 工作原理

整个工具就是一个 HTML 文件，没有框架、没有依赖、没有网络请求。核心逻辑按格式解析二进制结构：

- **JPEG**：遍历标记段，丢弃 `APP1(EXIF)`、`APP1(XMP)`、`APP13(IPTC)`、`APP2(MPF)`、`COM`，保留 `APP0(JFIF)`、`APP2(ICC)` 与全部图像数据；SOS 之后原样拷贝
- **PNG**：按块（chunk）过滤，丢弃 `eXIf` / `tEXt` / `zTXt` / `iTXt` / `tIME`
- **WebP**：按 RIFF 子块过滤，丢弃 `EXIF` / `XMP `，重写 RIFF 长度
- **GIF**：按扩展块解析，丢弃注释扩展与 XMP 应用扩展，动图帧完整保留
- **转正 / 转换**：`createImageBitmap`（显式 `imageOrientation: 'from-image'`）→ canvas → `toBlob`，编码后校验真实 MIME 防浏览器静默回退

处理进度与队列完全串行，边拖边加、任意批次追加，已完成的结果不会丢失；含 GPS 的文件会红字高亮提醒。

## 已知限制

- HEIC/HEIF 不支持——浏览器引擎不提供解码，属于网页工具的硬限制（可改用 [ExifCleaner](https://github.com/szTheory/exifcleaner) 等桌面方案）
- 超大照片（约 40MP 以上）在部分手机浏览器上转正/转换可能因内存受限失败（会标红提示，不会崩溃）
- 不处理视频 / PDF / Office 文档元数据
- 无损剥离只删元数据段，不能修改像素内容本身（如马赛克背后的人脸）

## 测试

```bash
python test/gen_fixtures.py   # 生成带 EXIF/GPS/方向标签的测试图（需 Pillow）
node  test/run_tests.mjs      # 从 index.html 抽取核心逻辑做结构测试（GIF/BMP 夹具在 Node 内构造）
python test/verify.py         # Pillow 独立交叉验证：EXIF 为空、像素无损
```

三件套之外还有真实浏览器端到端用例（多批次追加、格式切换重处理、WebP 编码回退模拟）。覆盖内容包括：JPEG/PNG/WebP/GIF/BMP 的剥离正确性、大端/小端 EXIF 解析、动图帧完整性、输出命名规则、无损路径像素逐位一致。

## 为什么不用现成工具？

| 方案 | 取舍 |
|---|---|
| Windows 右键"删除属性" | 只能逐个文件，清理不彻底 |
| [ExifCleaner](https://github.com/szTheory/exifcleaner)（2.8k★，活跃维护） | 好用但绿色版 122MB——清个元数据不必如此隆重 |
| 在线清理网站 | 照片要上传到别人的服务器，与目的相悖 |
| exiftool | 命令行，对非技术用户不友好 |

如果你需要批量处理整个文件夹、视频或 PDF，仍然推荐 ExifCleaner；日常几张照片，这个页面足够。

## License

[MIT](LICENSE) © YiqianFan
