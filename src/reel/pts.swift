// Print every video frame's presentation timestamp: "t=<seconds>" one per line.
import AVFoundation
import Foundation
let asset = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
let sem = DispatchSemaphore(value: 0)
Task {
  guard let track = try await asset.loadTracks(withMediaType: .video).first else { exit(1) }
  let reader = try AVAssetReader(asset: asset)
  let out = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
  reader.add(out); reader.startReading()
  var pts: [Double] = []
  while let sb = out.copyNextSampleBuffer() {
    let t = CMSampleBufferGetPresentationTimeStamp(sb)
    if t.isValid && !t.isIndefinite { pts.append(CMTimeGetSeconds(t)) }
  }
  for t in pts.sorted() { print(String(format: "t=%.4f", t)) }
  sem.signal()
}
sem.wait()
