// Renders an SVG to a PNG of an exact pixel size with a transparent background (AppKit's native SVG support).
// Usage: swift render.swift in.svg out.png width height
import AppKit
let a = CommandLine.arguments
guard a.count == 5, let w = Int(a[3]), let h = Int(a[4]), let img = NSImage(contentsOfFile: a[1]) else { fputs("usage: render in.svg out.png w h\n", stderr); exit(2) }
guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { exit(3) }
rep.size = NSSize(width: w, height: h)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current?.imageInterpolation = .high
NSColor.clear.set()
NSRect(x: 0, y: 0, width: w, height: h).fill()
img.draw(in: NSRect(x: 0, y: 0, width: w, height: h), from: .zero, operation: .sourceOver, fraction: 1)
NSGraphicsContext.restoreGraphicsState()
guard let data = rep.representation(using: .png, properties: [:]) else { exit(4) }
try! data.write(to: URL(fileURLWithPath: a[2]))
