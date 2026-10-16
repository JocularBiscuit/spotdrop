// Tiny CLI around Apple's Vision framework: prints recognized text lines as JSON.
// Built automatically by the server on macOS (swiftc -O vision-ocr.swift -o vision-ocr).
// Usage: vision-ocr <image-path>
import Foundation
import Vision
import AppKit

struct Line: Codable {
    let text: String
    let confidence: Float
    let x: Double, y: Double, w: Double, h: Double // normalized, origin top-left
}

guard CommandLine.arguments.count > 1 else {
    FileHandle.standardError.write("usage: vision-ocr <image>\n".data(using: .utf8)!)
    exit(2)
}

let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = NSImage(contentsOf: url),
      let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("cannot read image\n".data(using: .utf8)!)
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
if #available(macOS 13.0, *) { request.automaticallyDetectsLanguage = true }

do {
    try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
} catch {
    FileHandle.standardError.write("vision failed: \(error)\n".data(using: .utf8)!)
    exit(1)
}

var lines: [Line] = []
for obs in request.results ?? [] {
    guard let top = obs.topCandidates(1).first else { continue }
    let b = obs.boundingBox
    lines.append(Line(text: top.string, confidence: top.confidence,
                      x: b.minX, y: 1 - b.maxY, w: b.width, h: b.height))
}
lines.sort { abs($0.y - $1.y) > 0.01 ? $0.y < $1.y : $0.x < $1.x }

let data = try JSONEncoder().encode(lines)
FileHandle.standardOutput.write(data)
