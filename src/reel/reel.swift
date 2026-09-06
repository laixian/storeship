// Reel compositor: place a simulator recording into the band of a card and export an mp4.
//
//   reel <recording.mov> <card.png> <out.mp4> --canvas W,H --band X,Y,W,H [--crop L,R,T,B] [--fps 30]
//        [--start s] [--duration s] [--audio file.wav --audio-t0 s] [--no-rotate]
//
// 1. Upright: `simctl io recordVideo` always captures the portrait framebuffer, so a
//    landscape UI lies on its side. The rotation matrix is derived, not guessed:
//    source (x,y) → landscape (y, W−x), i.e. a=0 b=−1 c=1 d=0 tx=0 ty=W.
// 2. Into the band: crop (after rotation, before scaling — order matters), scale to
//    the band width, translate. Coordinates here are the video render space
//    (top-left origin, y down); CALayer's y-up is a different space, do not mix.
// 3. Card on top: it is a foreground with a transparent hole; a background would be
//    covered because the area outside the video is black, not transparent.
// Audio: `audio-t0` is the recording's timeline position where the audio's t=0 belongs.
import AVFoundation
import AppKit
import Foundation

var args = Array(CommandLine.arguments.dropFirst())
func die(_ m: String) -> Never { FileHandle.standardError.write("✗ \(m)\n".data(using: .utf8)!); exit(1) }
func opt(_ name: String) -> String? {
  guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
  let v = args[i + 1]; args.removeSubrange(i...(i + 1)); return v
}
func flag(_ name: String) -> Bool { if let i = args.firstIndex(of: name) { args.remove(at: i); return true }; return false }
func nums(_ s: String?, _ n: Int, _ what: String) -> [Double] {
  guard let s = s else { die("missing \(what)") }
  let v = s.split(separator: ",").compactMap { Double($0) }
  if v.count != n { die("\(what) needs \(n) numbers, got \"\(s)\"") }
  return v
}
let canvasV = nums(opt("--canvas"), 2, "--canvas W,H")
let bandV = nums(opt("--band"), 4, "--band X,Y,W,H")
let cropV = nums(opt("--crop") ?? "0,0,0,0", 4, "--crop L,R,T,B")
let FPS = Int32(opt("--fps") ?? "30") ?? 30
let startAt = Double(opt("--start") ?? "0") ?? 0
let wantDur = opt("--duration").flatMap { Double($0) }
let audioPath = opt("--audio")
let audioT0 = Double(opt("--audio-t0") ?? "0") ?? 0
let rotate = !flag("--no-rotate")
guard args.count >= 3 else { die("usage: reel <recording.mov> <card.png> <out.mp4> --canvas W,H --band X,Y,W,H …") }
let srcURL = URL(fileURLWithPath: args[0]), cardURL = URL(fileURLWithPath: args[1]), outURL = URL(fileURLWithPath: args[2])
let CANVAS = CGSize(width: canvasV[0], height: canvasV[1])
let BAND = (x: bandV[0], y: bandV[1], w: bandV[2], h: bandV[3])
let CROP = (left: cropV[0], right: cropV[1], top: cropV[2], bottom: cropV[3])

let sem = DispatchSemaphore(value: 0)
Task {
  let asset = AVURLAsset(url: srcURL)
  guard let srcTrack = try await asset.loadTracks(withMediaType: .video).first else { die("no video track in \(srcURL.path)") }
  let natural = try await srcTrack.load(.naturalSize)
  let full = CMTimeGetSeconds(try await asset.load(.duration))
  let clip = min(wantDur ?? full - startAt, full - startAt)
  guard clip > 0.5 else { die(String(format: "clip shorter than 0.5s (source %.1fs, start %.1fs)", full, startAt)) }
  let start = CMTime(seconds: startAt, preferredTimescale: 600)
  let dur = CMTime(seconds: clip, preferredTimescale: 600)

  let comp = AVMutableComposition()
  guard let ct = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { die("cannot add video track") }
  try ct.insertTimeRange(CMTimeRange(start: start, duration: dur), of: srcTrack, at: .zero)

  let rot = rotate ? CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: natural.width) : .identity
  let land = rotate ? CGSize(width: natural.height, height: natural.width) : natural
  let cropW = land.width - CROP.left - CROP.right
  let cropH = land.height - CROP.top - CROP.bottom
  let s = BAND.w / cropW
  let placed = rot
    .concatenating(CGAffineTransform(translationX: -CROP.left, y: -CROP.top))
    .concatenating(CGAffineTransform(scaleX: s, y: s))
    .concatenating(CGAffineTransform(translationX: BAND.x, y: BAND.y))
  let needH = cropH * s
  if abs(needH - BAND.h) > 2 {
    die(String(format: "band height must be %.0f (recording %.0f×%.0f, cropped %.0f×%.0f, scaled to width %.0f); the content file says %.0f — set band.h to %.0f",
               needH, land.width, land.height, cropW, cropH, BAND.w, BAND.h, needH))
  }

  if let ap = audioPath {
    let aAsset = AVURLAsset(url: URL(fileURLWithPath: ap))
    guard let aTrack = try await aAsset.loadTracks(withMediaType: .audio).first else { die("no audio track in \(ap)") }
    guard let at = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { die("cannot add audio track") }
    let aDur = CMTimeGetSeconds(try await aAsset.load(.duration))
    let at0 = audioT0 - startAt
    let srcFrom = max(0, -at0)
    let putAt = max(0, at0)
    let take = min(clip - putAt, aDur - srcFrom)
    if take <= 0 { die(String(format: "audio does not overlap the clip (t0=%.3f start=%.3f clip=%.1f audio=%.1f)", audioT0, startAt, clip, aDur)) }
    if aDur - srcFrom < clip - putAt {
      FileHandle.standardError.write(String(format: "⚠️ audio is %.1fs shorter than the picture; the end will be silent\n", (clip - putAt) - (aDur - srcFrom)).data(using: .utf8)!)
    }
    try at.insertTimeRange(CMTimeRange(start: CMTime(seconds: srcFrom, preferredTimescale: 600), duration: CMTime(seconds: take, preferredTimescale: 600)),
                           of: aTrack, at: CMTime(seconds: putAt, preferredTimescale: 600))
    print(String(format: "audio: %.1fs from %.3fs of the file, placed at %.3fs", take, srcFrom, putAt))
  }

  let inst = AVMutableVideoCompositionInstruction()
  inst.timeRange = CMTimeRange(start: .zero, duration: dur)
  let li = AVMutableVideoCompositionLayerInstruction(assetTrack: ct)
  li.setTransform(placed, at: .zero)
  inst.layerInstructions = [li]
  let vc = AVMutableVideoComposition()
  vc.renderSize = CANVAS
  vc.frameDuration = CMTime(value: 1, timescale: FPS)
  vc.instructions = [inst]

  guard let img = NSImage(contentsOf: cardURL), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { die("cannot read card \(cardURL.path)") }
  let parent = CALayer(); parent.frame = CGRect(origin: .zero, size: CANVAS)
  parent.isGeometryFlipped = true
  let videoLayer = CALayer(); videoLayer.frame = parent.frame
  let cardLayer = CALayer(); cardLayer.frame = parent.frame
  cardLayer.contents = cg
  cardLayer.contentsGravity = .resize
  parent.addSublayer(videoLayer)
  parent.addSublayer(cardLayer)
  vc.animationTool = AVVideoCompositionCoreAnimationTool(postProcessingAsVideoLayer: videoLayer, in: parent)

  try? FileManager.default.removeItem(at: outURL)
  guard let ex = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetHighestQuality) else { die("cannot create export session") }
  ex.outputURL = outURL
  ex.outputFileType = .mp4
  ex.videoComposition = vc
  await ex.export()
  if ex.status != .completed { die("export failed: \(String(describing: ex.error))") }
  let outAsset = AVURLAsset(url: outURL)
  let ot = try await outAsset.loadTracks(withMediaType: .video).first!
  let osize = try await ot.load(.naturalSize)
  let odur = try await outAsset.load(.duration)
  print(String(format: "✓ %@ %.0f×%.0f %.2fs", outURL.lastPathComponent, osize.width, osize.height, CMTimeGetSeconds(odur)))
  sem.signal()
}
sem.wait()
